import { useCallback } from 'react'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { flushProject } from '@/editor/persistence/projectPersistence'
import { canvasDraftDirty,saveAbandonedCanvasDraft } from './canvasDraftGuard'
import { InsertGeneratedAssetCommand } from '@/editor/commands'
import { IMAGE_SIZE_PRESETS } from '@/features/free-canvas/generation/config'
import { bindRuntimeImage,releaseRuntimeImageUser } from '@/editor/runtimeImages'
import { useEffect,useRef } from 'react'
import type { TaskCenterDetail } from '@shared/task-center'
import { useTaskDraftGuard } from './useTaskDraftGuard'
import { applyRecoveredCanvasTask,type CanvasRecoveryContext } from './canvasRecovery'
import { assertRecoveryActor } from './recoveryMedia'
import TaskRecoveryPanel,{type RecoveryActionContext} from './TaskRecoveryPanel'

const tools=['text-to-image','variation','text-to-video','image-to-video'] as const
export default function CanvasTaskRecovery({onTaskObserved}:{onTaskObserved:(detail:TaskCenterDetail)=>void}) {
  const project=useEditorStore(state=>state.project),sceneId=useEditorStore(state=>state.activeSceneId)
  const epoch=usePersistenceStore(state=>state.epoch),writable=usePersistenceStore(state=>state.writable),phase=usePersistenceStore(state=>state.phase)
  const drafts=usePersistenceStore(state=>state.drafts)
  const saveStatus=usePersistenceStore(state=>state.status)
  const runtime=useRef({})
  useEffect(()=>{const user=runtime.current;return()=>releaseRuntimeImageUser(user)},[])
  const dirty=saveStatus==='dirty'||saveStatus==='saving'
  const confirm=useTaskDraftGuard({dirty,reason:'当前画布尚未保存，请保存后再切换。',
    blocked:dirty&&(!writable||phase!=='ready')?'当前画布尚未保存且不可写，请先处理编辑状态':undefined,
    beforeLeave:async()=>{try{await flushProject();return usePersistenceStore.getState().status==='saved'?'saved' as const:true}catch{return true}}})
  useTaskDraftGuard({dirty:canvasDraftDirty(drafts),navigationScope:'canvas-task',
    reason:'当前画布的生成提示词尚未提交。切换任务后这些提示词将被清空。',
    blocked:canvasDraftDirty(drafts)&&(!writable||phase!=='ready')?'请先取得当前项目编辑权':undefined,
    onAbandon:async()=>{
      if(usePersistenceStore.getState().epoch!==epoch||useEditorStore.getState().project?.id!==project?.id)throw new Error('项目编辑状态已变化')
      await saveAbandonedCanvasDraft(flushProject,epoch)
    }})
  const projectId=project?.id
  const context=useCallback((input:RecoveryActionContext):CanvasRecoveryContext=>{
    if(!projectId||!sceneId)throw new Error('原画布或场景未准备好')
    return {...input,projectId,sceneId,epoch}
  },[projectId,sceneId,epoch])
  const observe=useCallback(async(detail:TaskCenterDetail,input:RecoveryActionContext)=>{
    if(!writable||phase!=='ready'||detail.task.origin?.entry!=='canvas')return
    assertRecoveryActor(input.actor,input.signal)
    const origin=detail.task.origin,editor=useEditorStore.getState()
    if(!editor.project?.document.scenes.some(scene=>scene.id===origin.sceneId))throw new Error('原任务场景不存在，可继续查看结果')
    if(origin.sceneId!==sceneId){editor.setActiveScene(origin.sceneId);return}
    onTaskObserved(detail)
    await applyRecoveredCanvasTask(detail,context(input))
    assertRecoveryActor(input.actor,input.signal)
  },[context,writable,phase,sceneId,onTaskObserved])
  return <TaskRecoveryPanel tools={tools} projectId={project?.id} onObserve={observe}
    blockedReason={!writable||phase!=='ready'?'请先取得当前项目编辑权':undefined}
    onAddResult={async(result,detail,input)=>{await applyRecoveredCanvasTask(detail,context(input),result)}}
    onLoadParameters={async(prepared,detail,input)=>{
      assertRecoveryActor(input.actor,input.signal)
      const origin=detail.task.origin
      if(origin?.entry!=='canvas'||origin.sceneId!==sceneId)throw new Error('请先进入原任务场景')
      const values=prepared.params
      if(typeof values.prompt!=='string'||typeof values.count!=='number')throw new Error('原生成参数不完整')
      if(drafts['text-to-image'].prompt||drafts['text-to-video'].prompt||drafts.derived?.prompt){
        if(!await confirm('载入原任务参数会替换当前生成参数；派生任务的原输入不在画布时会添加原输入图。',true))return false
      }
      assertRecoveryActor(input.actor,input.signal)
      if(!usePersistenceStore.getState().writable||usePersistenceStore.getState().epoch!==epoch)throw new Error('项目编辑状态已变化')
      const state=usePersistenceStore.getState(),size=values.size as {width?:number;height?:number}|undefined
      const preset=typeof values.ratio==='string'?values.ratio:IMAGE_SIZE_PRESETS.find(preset=>preset.width===size?.width&&preset.height===size?.height)?.key
      if(origin.tool==='variation'||origin.tool==='image-to-video') {
        if(!prepared.source||!prepared.sourceBlob)throw new Error('原输入图片不可读取')
        const editor=useEditorStore.getState(),scene=editor.project!.document.scenes.find(scene=>scene.id===sceneId)!
        const existing=Object.values(editor.project!.assets).find(asset=>asset.type==='image'&&asset.objectKey===prepared.source!.objectKey)
        const source=existing?.type==='image'?existing:prepared.source
        bindRuntimeImage(input.actor.owner,source,prepared.sourceBlob,runtime.current)
        let sourceNode=scene.nodes.find(node=>node.type==='image'&&node.assetId===source.id)
        if(!sourceNode){
          sourceNode={id:`task-input:${detail.task.sourceId}`,type:'image',assetId:source.id,x:scene.width/2-160,y:scene.height/2-160,width:Math.min(320,source.width),height:Math.min(320,source.height),rotation:0,opacity:1,visible:true,locked:false,zIndex:Math.max(-1,...scene.nodes.map(node=>node.zIndex))+1}
          editor.executeCommand(new InsertGeneratedAssetCommand(scene.id,source,sourceNode))
        }
        if(sourceNode.type!=='image')throw new Error('原输入节点不可用')
        // 显式载入派生参数时复用原输入节点；缺失时添加输入图，不启动生成。
        state.setDrafts({...state.drafts,derived:{mode:origin.tool,sourceAssetId:source.id,
          sourceNode,
          prompt:values.prompt,count:values.count,durationSeconds:values.durationSeconds===10?10:5,modelProfileId:detail.task.modelProfileId??undefined,
          resolution:values.resolution as '1k'|'2k'|'4k'|'720p'|undefined,generateAudio:values.generateAudio===true}})
      } else {
        const tool=origin.tool
        state.setDrafts({...state.drafts,[tool]:{...state.drafts[tool],prompt:values.prompt,count:values.count,presetKey:preset??state.drafts[tool].presetKey,
          durationSeconds:values.durationSeconds===10?10:5,resolution:values.resolution as '1k'|'2k'|'4k'|'720p'|undefined,
          modelProfileId:detail.task.modelProfileId??undefined,generateAudio:values.generateAudio===true,enableThinking:values.enableThinking===true}})
      }
    }}/>
}
