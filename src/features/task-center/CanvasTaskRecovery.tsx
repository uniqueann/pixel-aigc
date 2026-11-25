import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { VIDEO_REPLICATION_RATIOS } from '@shared/video-replication'
import { inspectVideoReference } from '@/services/api/videoReferences'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { flushProject } from '@/editor/persistence/projectPersistence'
import { canvasDraftDirty,saveAbandonedCanvasDraft } from './canvasDraftGuard'
import { InsertGeneratedAssetCommand } from '@/editor/commands'
import { IMAGE_SIZE_PRESETS } from '@/features/free-canvas/generation/config'
import { bindRuntimeImage,releaseRuntimeImageUser } from '@/editor/runtimeImages'
import { canonicalizeImageModelProfileId } from '@shared/image-models'
import type { TaskCenterDetail } from '@shared/task-center'
import { useTaskDraftGuard } from './useTaskDraftGuard'
import { applyRecoveredCanvasTask,type CanvasRecoveryContext } from './canvasRecovery'
import { assertRecoveryActor } from './recoveryMedia'
import TaskRecoveryPanel,{type RecoveryActionContext} from './TaskRecoveryPanel'

const tools=['text-to-image','variation','text-to-video','image-to-video','video-replication'] as const
export default function CanvasTaskRecovery({onTaskObserved}:{onTaskObserved:(detail:TaskCenterDetail)=>void}) {
  const { t } = useTranslation('taskCenter')
  const project=useEditorStore(state=>state.project),sceneId=useEditorStore(state=>state.activeSceneId)
  const epoch=usePersistenceStore(state=>state.epoch),writable=usePersistenceStore(state=>state.writable),phase=usePersistenceStore(state=>state.phase)
  const drafts=usePersistenceStore(state=>state.drafts)
  const saveStatus=usePersistenceStore(state=>state.status)
  const runtime=useRef({})
  useEffect(()=>{const user=runtime.current;return()=>releaseRuntimeImageUser(user)},[])
  const dirty=saveStatus==='dirty'||saveStatus==='saving'
  const confirm=useTaskDraftGuard({dirty,reason:t('canvas.unsavedLeaveReason'),
    blocked:dirty&&(!writable||phase!=='ready')?t('canvas.unsavedReadonlyBlocked'):undefined,
    beforeLeave:async()=>{try{await flushProject();return usePersistenceStore.getState().status==='saved'?'saved' as const:true}catch{return true}}})
  useTaskDraftGuard({dirty:canvasDraftDirty(drafts),navigationScope:'canvas-task',
    reason:t('canvas.unsubmittedPromptReason'),
    blocked:canvasDraftDirty(drafts)&&(!writable||phase!=='ready')?t('canvas.projectReadOnly'):undefined,
    onAbandon:async()=>{
      if(usePersistenceStore.getState().epoch!==epoch||useEditorStore.getState().project?.id!==project?.id)throw new Error(t('errors.projectEditStateChanged'))
      await saveAbandonedCanvasDraft(flushProject,epoch)
    }})
  const projectId=project?.id
  const context=useCallback((input:RecoveryActionContext):CanvasRecoveryContext=>{
    if(!projectId||!sceneId)throw new Error(t('errors.canvasNotReady'))
    return {...input,projectId,sceneId,epoch}
  },[projectId,sceneId,epoch,t])
  const observe=useCallback(async(detail:TaskCenterDetail,input:RecoveryActionContext)=>{
    if(!writable||phase!=='ready'||detail.task.origin?.entry!=='canvas')return
    assertRecoveryActor(input.actor,input.signal)
    const origin=detail.task.origin,editor=useEditorStore.getState()
    if(!editor.project?.document.scenes.some(scene=>scene.id===origin.sceneId))throw new Error(t('errors.originalSceneMissingShort'))
    if(origin.sceneId!==sceneId){editor.setActiveScene(origin.sceneId);return}
    onTaskObserved(detail)
    await applyRecoveredCanvasTask(detail,context(input))
    assertRecoveryActor(input.actor,input.signal)
  },[context,writable,phase,sceneId,onTaskObserved,t])
  return <TaskRecoveryPanel tools={tools} projectId={project?.id} onObserve={observe}
    blockedReason={!writable||phase!=='ready'?t('canvas.projectReadOnly'):undefined}
    onAddResult={async(result,detail,input)=>{await applyRecoveredCanvasTask(detail,context(input),result)}}
    onLoadParameters={async(prepared,detail,input)=>{
      assertRecoveryActor(input.actor,input.signal)
      const origin=detail.task.origin
      if(origin?.entry!=='canvas'||origin.sceneId!==sceneId)throw new Error(t('errors.enterOriginalSceneFirst'))
      const values=prepared.params
      if(typeof values.prompt!=='string'||typeof values.count!=='number')throw new Error(t('errors.incompleteGenParams'))
      if(canvasDraftDirty(drafts)){
        if(!await confirm(t('canvas.confirmReplaceParams'),true))return false
      }
      assertRecoveryActor(input.actor,input.signal)
      if(!usePersistenceStore.getState().writable||usePersistenceStore.getState().epoch!==epoch)throw new Error(t('errors.projectEditStateChanged'))
      const state=usePersistenceStore.getState(),size=values.size as {width?:number;height?:number}|undefined
      const preset=typeof values.ratio==='string'?values.ratio:IMAGE_SIZE_PRESETS.find(preset=>preset.width===size?.width&&preset.height===size?.height)?.key
      if(origin.tool==='video-replication'){
        const ratio=VIDEO_REPLICATION_RATIOS.find(ratio=>ratio===values.ratio)
        const durationSeconds=values.durationSeconds
        if(origin.projectSource!=='local'||!ratio||typeof durationSeconds!=='number'||!Number.isInteger(durationSeconds)
          ||durationSeconds<4||durationSeconds>15||typeof values.referenceVideoKey!=='string'||!prepared.source||!prepared.sourceBlob){
          throw new Error(t('errors.replicationParamsUnavailable'))
        }
        const { key, width, height, durationSeconds: referenceDuration, retentionExpiresAt } =
          await inspectVideoReference(values.referenceVideoKey,input.signal)
        assertRecoveryActor(input.actor,input.signal)
        const current=usePersistenceStore.getState()
        if(!current.writable||current.epoch!==epoch||useEditorStore.getState().activeSceneId!==sceneId)throw new Error(t('errors.projectEditStateChanged'))
        const editor=useEditorStore.getState()
        const product=prepared.source
        const existing=Object.values(editor.project?.assets??{}).find(asset=>asset.type==='image'&&asset.objectKey===product.objectKey)
        const source=existing?.type==='image'?existing:product
        bindRuntimeImage(input.actor.owner,source,prepared.sourceBlob,runtime.current)
        editor.registerAsset(source)
        current.setDrafts({...current.drafts,derived:undefined,videoReplication:{
          ownerId: input.actor.owner, productAssetId:source.id, prompt:values.prompt, ratio, durationSeconds,
          reference:{ key,width,height,durationSeconds:referenceDuration,retentionExpiresAt,name:t('canvas.referenceVideoName') },
        }})
      } else if(origin.tool==='variation'||origin.tool==='image-to-video') {
        if(!prepared.source||!prepared.sourceBlob)throw new Error(t('errors.sourceImageUnreadable'))
        const editor=useEditorStore.getState(),scene=editor.project!.document.scenes.find(scene=>scene.id===sceneId)!
        const existing=Object.values(editor.project!.assets).find(asset=>asset.type==='image'&&asset.objectKey===prepared.source!.objectKey)
        const source=existing?.type==='image'?existing:prepared.source
        bindRuntimeImage(input.actor.owner,source,prepared.sourceBlob,runtime.current)
        let sourceNode=scene.nodes.find(node=>node.type==='image'&&node.assetId===source.id)
        if(!sourceNode){
          sourceNode={id:`task-input:${detail.task.sourceId}`,type:'image',assetId:source.id,x:scene.width/2-160,y:scene.height/2-160,width:Math.min(320,source.width),height:Math.min(320,source.height),rotation:0,opacity:1,visible:true,locked:false,zIndex:Math.max(-1,...scene.nodes.map(node=>node.zIndex))+1}
          editor.executeCommand(new InsertGeneratedAssetCommand(scene.id,source,sourceNode))
        }
        if(sourceNode.type!=='image')throw new Error(t('errors.sourceNodeUnavailable'))
        // 显式载入派生参数时复用原输入节点；缺失时添加输入图，不启动生成。
        state.setDrafts({...state.drafts,derived:{mode:origin.tool,sourceAssetId:source.id,
          sourceNode,
          prompt:values.prompt,count:values.count,durationSeconds:values.durationSeconds===10?10:5,modelProfileId:canonicalizeImageModelProfileId(detail.task.modelProfileId??undefined),
          ...(origin.tool==='image-to-video'?{videoResolution:values.resolution as '720p'|'768p'|'2k'|undefined}
            :{resolution:values.resolution as '1k'|'2k'|'4k'|undefined}),generateAudio:values.generateAudio===true}})
      } else {
        const tool=origin.tool
        state.setDrafts({...state.drafts,[tool]:{...state.drafts[tool],prompt:values.prompt,count:values.count,presetKey:preset??state.drafts[tool].presetKey,
          durationSeconds:values.durationSeconds===10?10:5,
          ...(tool==='text-to-video'?{videoResolution:values.resolution as '720p'|'768p'|'2k'|undefined,resolution:undefined}
            :{resolution:values.resolution as '1k'|'2k'|'4k'|undefined}),
          modelProfileId:canonicalizeImageModelProfileId(detail.task.modelProfileId??undefined),generateAudio:values.generateAudio===true,enableThinking:values.enableThinking===true}})
      }
    }}/>
}
