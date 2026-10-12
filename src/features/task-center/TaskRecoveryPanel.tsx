import { useContext,useEffect, useRef, useState } from 'react'
import { UNSAFE_LocationContext } from 'react-router-dom'
import { Alert, App, Button, Card, Image, Space, Spin } from 'antd'
import VideoPlayer from '@/components/VideoPlayer'
import type { TaskCenterDetail, TaskCenterMedia, TaskTool } from '@shared/task-center'
import { taskBillingLabel,taskStateLabel } from '@shared/task-center'
import { useRecoveredTask } from './useRecoveredTask'
import { useTaskCenter } from './context'
import { assertRecoveryActor,prepareRecoveryParameters,readRecoveryImage,type PreparedRecoveryParameters } from './recoveryMedia'
import type { TaskActor } from './client'
import { useUserStore } from '@/store/useUserStore'

export interface RecoveryActionContext { actor: TaskActor; signal: AbortSignal }
interface Props {
  tools: readonly TaskTool[]
  projectId?: string
  onUseImage?: (result: TaskCenterMedia, blob: Blob, detail: TaskCenterDetail, context: RecoveryActionContext) => Promise<void> | void
  onLoadParameters?: (prepared: PreparedRecoveryParameters, detail: TaskCenterDetail, context: RecoveryActionContext) => Promise<void | boolean> | void | boolean
  onAddResult?: (result: TaskCenterMedia, detail: TaskCenterDetail, context: RecoveryActionContext) => Promise<void> | void
  blockedReason?: string
  onObserve?: (detail: TaskCenterDetail, context: RecoveryActionContext) => Promise<void>
}
export default function TaskRecoveryPanel(props:Props) {
  const location=useContext(UNSAFE_LocationContext)
  const owner=useUserStore(state=>state.userId),scope=useUserStore(state=>state.account?.runtimeScope)
  if(!location || !new URLSearchParams(location.location.search).has('task'))return null
  return <RecoveryPanelContent key={`${owner}:${scope}:${location.location.pathname}:${new URLSearchParams(location.location.search).get('task')}`} {...props}/>
}
function RecoveryPanelContent({tools,projectId,onUseImage,onLoadParameters,onAddResult,blockedReason,onObserve}:Props) {
  const recovery=useRecoveredTask(tools,projectId),center=useTaskCenter()
  const {message}=App.useApp()
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState<string>()
  const controller=useRef<AbortController>()
  const version=`${recovery.actor?.owner}:${recovery.actor?.scope}:${recovery.identity?.taskKey}`
  useEffect(()=>{const request=new AbortController();controller.current=request;return()=>request.abort()},[version])
  useEffect(()=>{
    if(!recovery.data||!recovery.actor||!onObserve||!controller.current)return
    const context={actor:recovery.actor,signal:controller.current.signal}
    void onObserve(recovery.data,context).catch(error=>{if(!context.signal.aborted)setActionError(error instanceof Error?error.message:'原任务恢复失败，可继续查看结果')})
  },[recovery.data,onObserve,recovery.actor])
  if (!recovery.present) return null
  const detail=recovery.data
  const run=async (operation:(context:RecoveryActionContext)=>Promise<void>)=>{
    if(!recovery.actor||!controller.current||blockedReason||busy)return
    const context={actor:recovery.actor,signal:controller.current.signal}
    setBusy(true);setActionError(undefined)
    try {await operation(context);assertRecoveryActor(context.actor,context.signal)}
    catch(error){if(!context.signal.aborted){setActionError(error instanceof Error?error.message:'操作失败');message.error(error instanceof Error?error.message:'操作失败')}}
    finally{if(!context.signal.aborted)setBusy(false)}
  }
  const medias=detail?.results.filter((result):result is TaskCenterMedia=>result.kind!=='text')??[]
  const loadParameters=(prepareGeneration=false)=>void run(async context=>{
    if(!detail||!onLoadParameters)return
    const prepared=await prepareRecoveryParameters(detail,context.actor,context.signal)
    const applied=await onLoadParameters(prepared,detail,context)
    assertRecoveryActor(context.actor,context.signal)
    if(prepareGeneration&&applied!==false)requestAnimationFrame(()=>{
      if(!context.signal.aborted){const button=document.querySelector<HTMLElement>('[data-task-generate]');button?.scrollIntoView({block:'center',behavior:'smooth'});button?.focus()}
    })
  })
  return <Card size="small" className="task-recovery-panel" title="已有任务" extra={<Button size="small" disabled={busy} onClick={recovery.close}>返回当前编辑</Button>}>
    {recovery.invalid?<Alert type="error" message="任务定位参数无效" showIcon/>:!recovery.enabled?<Alert type="info" message="任务恢复暂不可用，请确认登录及任务中心功能已启用" showIcon/>:null}
    {recovery.loading?<Spin/>:null}
    {recovery.error?<Alert type="warning" showIcon message="原任务暂不可读取，不会因此重新生成" description={recovery.error instanceof Error?recovery.error.message:undefined} action={<Button size="small" onClick={recovery.refresh}>重新读取</Button>}/>:null}
    {detail?<>
      <p>{taskStateLabel(detail.task)} · {detail.task.completedCount}/{detail.task.requestedCount} · {taskBillingLabel(detail.task)}</p>
      {detail.errorMessage?<Alert type="warning" showIcon message={detail.errorMessage}/>:null}
      {detail.task.origin?.entry==='canvas' && detail.task.origin.sceneId!==undefined?<small>原任务场景：{detail.task.origin.sceneId}</small>:null}
      <Space wrap><Button size="small" onClick={recovery.refresh}>重新读取</Button><Button size="small" onClick={()=>center?.show(detail.task)}>查看完整详情及下载</Button>
        {onLoadParameters?<><Button size="small" disabled={!detail.params||!!blockedReason} loading={busy} onClick={()=>loadParameters()}>载入原参数</Button><Button size="small" disabled={!detail.params||!!blockedReason} loading={busy} onClick={()=>loadParameters(true)}>准备重新生成</Button></>:null}</Space>
      {!detail.params?<p>此任务未保存完整原参数，可查看结果或将结果作为新输入。</p>:null}
      {blockedReason?<Alert type="info" message={blockedReason}/>:null}
      {actionError?<Alert type="warning" message={actionError}/>:null}
      <div className="task-recovery-results">{medias.map(result=><div key={`${result.ordinal}:${result.objectKey}`}>
        {result.availability!=='available'?<p>结果 {result.ordinal+1}：{result.availability==='expired'?'已过期':'暂不可读取'}</p>:<>
          {result.kind==='video'?<VideoPlayer reference={{objectKey:result.objectKey,url:result.url,expiresAt:Date.parse(result.urlExpiresAt),retentionExpiresAt:detail.task.resultExpiresAt??undefined}} ownerId={recovery.actor?.owner}/>:<Image src={result.url} alt={`原任务结果 ${result.ordinal+1}`} width={160}/>}
          <Space wrap>{onUseImage&&result.kind==='image'?<Button size="small" disabled={!!blockedReason} loading={busy} onClick={()=>void run(async context=>{
            const measured=await readRecoveryImage(result,context.actor,context.signal);await onUseImage(result,measured.blob,detail,context)
          })}>将结果作为新输入</Button>:null}
          {onAddResult?<Button size="small" disabled={!!blockedReason} loading={busy} onClick={()=>void run(async context=>{await onAddResult(result,detail,context)})}>添加已有结果</Button>:null}</Space>
        </>}
      </div>)}</div>
      {detail.results.map((result,index)=>result.kind==='text'?<div key={index} className="task-recovery-text"><p>原生成结果</p><pre>{result.text}</pre>{result.editedText!==null?<><p>已有修改稿</p><pre>{result.editedText}</pre></>:null}<Button size="small" onClick={()=>void run(async context=>{assertRecoveryActor(context.actor,context.signal);await navigator.clipboard.writeText(result.editedText??result.text);message.success('结果已复制')})}>复制已有结果</Button></div>:null)}
    </>:null}
  </Card>
}
