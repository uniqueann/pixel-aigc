import type { TaskCenterDetail, TaskCenterMedia } from '@shared/task-center'
import { Capability } from '@/types'
import { useEditorStore } from '@/editor/store'
import { recoveryForTask,usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { flushProject } from '@/editor/persistence/projectPersistence'
import { createImageAsset,createVideoAsset } from '@/editor/services/assetService'
import { generationIdForTask } from '@/editor/adapters/taskAdapter'
import { ResolveGenerationCommand } from '@/editor/commands'
import type { ImageAsset,VideoAsset,ImageNode,VideoNode } from '@/editor/types'
import { assertRecoveryActor,persistRecoveredResult,readRecoveryImage,recoveredResultId } from './recoveryMedia'
import type { RecoveryActionContext } from './TaskRecoveryPanel'

export interface CanvasRecoveryContext extends RecoveryActionContext { projectId: string; sceneId: string; epoch: number }
function check(context:CanvasRecoveryContext) {
  assertRecoveryActor(context.actor,context.signal)
  const state=usePersistenceStore.getState(),editor=useEditorStore.getState()
  if(state.epoch!==context.epoch||editor.project?.id!==context.projectId||editor.activeSceneId!==context.sceneId)throw new DOMException('画布或场景已切换','AbortError')
  if(!state.writable||state.phase!=='ready'||state.cloud?.conflict)throw new Error('当前项目不能编辑，请先取得编辑权或处理冲突')
  if(!editor.project.document.scenes.some(scene=>scene.id===context.sceneId))throw new Error('原任务场景不存在，可在任务详情查看结果')
}
export async function applyRecoveredCanvasTask(detail:TaskCenterDetail,context:CanvasRecoveryContext,explicit?:TaskCenterMedia) {
  check(context)
  const task=detail.task,editor=useEditorStore.getState(),project=editor.project!,scene=project.document.scenes.find(scene=>scene.id===context.sceneId)!
  if(task.origin?.entry!=='canvas'||task.origin.projectId!==context.projectId||task.origin.sceneId!==context.sceneId)throw new Error('原任务不属于当前项目或场景')
  let record=recoveryForTask(task.sourceId)
  if(!record){
    const pending=Object.values(usePersistenceStore.getState().recoveries).find(item=>item.projectId===context.projectId&&item.sceneId===context.sceneId&&!item.abandoned
      &&(!item.ownerId||item.ownerId===context.actor.owner)&&item.request.requestId===task.requestId&&!item.backendTaskId)
    if(pending){record={...pending,backendTaskId:task.sourceId};usePersistenceStore.getState().setRecovery(record)}
  }
  const generationId=generationIdForTask(task.sourceId),old=project.generations[generationId]
  const placeholders=scene.nodes.filter(node=>node.type==='generation'&&node.generationId===generationId)
  const matched=(record?.projectId===context.projectId&&record.sceneId===context.sceneId&&(!record.ownerId||record.ownerId===context.actor.owner)&&!record.abandoned)||placeholders.length>0
  if(!explicit&&!matched)return
  const candidates=explicit?[explicit]:detail.results.filter((result):result is TaskCenterMedia=>result.kind!=='text'&&result.availability==='available')
  const outputs:Array<{asset:ImageAsset|VideoAsset;node:ImageNode|VideoNode}>=[]
  for(const result of candidates) {
    check(context)
    const nodeId=`generated-node:${task.sourceId}:${result.ordinal}`
    const existingAsset=Object.values(project.assets).find((asset):asset is ImageAsset|VideoAsset=>(asset.type==='image'||asset.type==='video')&&asset.objectKey===result.objectKey)
    // 已插入或被用户删除的既有结果不因刷新重新添加；迟到的新序号仍可接回。
    if(scene.nodes.some(node=>node.id===nodeId)||(!explicit&&existingAsset&&old?.outputAssetIds.includes(existingAsset.id)))continue
    const id=existingAsset?.id??`asset:${recoveredResultId(detail,result)}`
    let asset:ImageAsset|VideoAsset
    let blob:Blob|undefined
    if(result.kind==='image') {
      const measured=await readRecoveryImage(result,context.actor,context.signal);blob=measured.blob
      asset=existingAsset??createImageAsset({id,name:`原任务结果 ${result.ordinal+1}`,url:result.url,objectKey:result.objectKey,width:measured.width,height:measured.height,mimeType:measured.mimeType,source:'generation',generationId,createdAt:task.createdAt})
    } else {
      if(!result.video)throw new Error('原视频元数据不完整，可在详情播放和下载')
      asset=existingAsset??createVideoAsset({id,name:'原视频结果',url:result.url,objectKey:result.objectKey,width:result.width,height:result.height,duration:result.video.durationSeconds,
        retentionExpiresAt:result.video.retentionExpiresAt,posterKey:result.video.posterKey,hasAudio:result.video.hasAudio,generationId,createdAt:task.createdAt})
    }
    check(context)
    const placement=placeholders.find(node=>node.type==='generation'&&node.resultIndex===result.ordinal)??record?.placements[result.ordinal]
    const width=placement?.width??Math.min(320,asset.width||320),height=placement?.height??Math.min(320,asset.height||320)
    const common={id:nodeId,assetId:asset.id,name:asset.name,x:placement?.x??scene.width/2-width/2,y:placement?.y??scene.height/2-height/2,width,height,
      rotation:0,opacity:1,visible:true,locked:false,zIndex:Math.max(-1,...scene.nodes.map(node=>node.zIndex))+1+outputs.length}
    const node:ImageNode|VideoNode=asset.type==='video'?{...common,type:'video',duration:asset.duration,startTime:0}:{...common,type:'image'}
    outputs.push({asset,node})
    await persistRecoveredResult(detail,result,context.actor,context.signal,blob)
  }
  check(context)
  const current=useEditorStore.getState(),currentScene=current.project!.document.scenes.find(scene=>scene.id===context.sceneId)!
  const fresh=outputs.filter(output=>!currentScene.nodes.some(node=>node.id===output.node.id))
  const terminal=!['queued','processing'].includes(task.state)
  const remove=placeholders.filter(node=>terminal||fresh.some(output=>output.node.id===`generated-node:${task.sourceId}:${node.type==='generation'?node.resultIndex??0:0}`)).map(node=>node.id)
  if(fresh.length||remove.length)current.executeCommand(new ResolveGenerationCommand(context.sceneId,remove,fresh))
  const previous=useEditorStore.getState().project!.generations[generationId]
  if(matched||explicit)current.registerGeneration({id:generationId,backendTaskId:task.sourceId,capability:task.capability as Capability,
    status:task.state==='expired'?'failed':task.state,input:detail.params??previous?.input??{},inputAssetIds:record?.context.inputAssetIds??previous?.inputAssetIds??[],
    outputAssetIds:[...new Set([...(previous?.outputAssetIds??[]),...fresh.map(output=>output.asset.id)])],createdAt:task.createdAt,updatedAt:task.updatedAt,error:detail.errorMessage??undefined})
  if(record&&terminal)usePersistenceStore.getState().setRecovery({...record,applied:true})
  if(fresh.length)current.selectNodes([fresh[0].node.id])
  if(fresh.length||remove.length||previous?.status!==task.state)await flushProject()
}
