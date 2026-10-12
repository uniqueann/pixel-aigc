import { useContext,useEffect,useMemo,useRef,useState } from 'react'
import { UNSAFE_LocationContext,useSearchParams } from 'react-router-dom'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { Alert,Button,Space } from 'antd'
import { useUserStore } from '@/store/useUserStore'
import { taskIsActive,type TaskCenterDetail,type TaskCenterMedia,type TaskTool } from '@shared/task-center'
import { CloudError } from '@/cloud/client'
import { readTaskDetail,readTaskHistory,sameTaskActor,taskCenterKeys,type TaskActor } from './client'
import { readRecoveryImage,assertRecoveryActor } from './recoveryMedia'
import { taskMatchesTool } from './route'
import { readWorkstationSession,saveWorkstationSession } from './workstationSession'
import { useTaskCenter } from './context'
import type { RecoveryActionContext } from './TaskRecoveryPanel'

interface Props {
  tool:TaskTool
  nativeBusy:boolean
  hasDraft:boolean
  onRestoreInput:(result:TaskCenterMedia,image:Awaited<ReturnType<typeof readRecoveryImage>>,detail:TaskCenterDetail,context:RecoveryActionContext)=>void|Promise<void>
}
export default function WorkstationRecovery(props:Props) {
  const location=useContext(UNSAFE_LocationContext)
  const account=useUserStore(state=>state.account),userId=useUserStore(state=>state.userId)
  if(!location||account?.userId!==userId||!account?.runtimeScope||!account.features?.taskCenter)return null
  return <RecoverySession key={`${userId}:${account.runtimeScope}:${props.tool}`} {...props} actor={{owner:account.userId,scope:account.runtimeScope}}/>
}
function RecoverySession({tool,nativeBusy,hasDraft,onRestoreInput,actor:inputActor}:Props&{actor:TaskActor}) {
  const actor=useMemo(()=>({owner:inputActor.owner,scope:inputActor.scope}),[inputActor.owner,inputActor.scope])
  const [params,setParams]=useSearchParams(),client=useQueryClient(),center=useTaskCenter()
  const [inputError,setInputError]=useState<string>(),[retry,setRetry]=useState(0)
  const discoveryDone=useRef(params.has('task'))
  const current=useRef({hasDraft,onRestoreInput,nativeBusy,params})
  useEffect(()=>{current.current={hasDraft,onRestoreInput,nativeBusy,params}})
  const query=useQuery({queryKey:[...taskCenterKeys.root(actor),'workstation-discovery',tool],enabled:!params.has('task')&&!nativeBusy,retry:false,
    queryFn:async({signal})=>{
      // 每次进入工具只发现一次；返回编辑后不再次打开刚刚关闭的任务。
      if(discoveryDone.current)return {items:[],bound:undefined}
      const bound=readWorkstationSession(actor,tool)?.task
      if(bound) {
        try {
          const detail=await readTaskDetail(actor,bound.sourceKind,bound.sourceId,signal)
          if(taskMatchesTool(detail.task,[tool]))return {bound:detail,items:[detail.task]}
        } catch(error) {if(!(error instanceof CloudError)||![404,410].includes(error.status))throw error}
        saveWorkstationSession(actor,tool,{task:undefined})
      }
      // 同名画布任务不自动绑定工作站；找到多项时保留选择权。
      const items=[] as TaskCenterDetail['task'][]
      let cursor:string|undefined
      do {
        const page=await readTaskHistory(actor,{tool,state:'active'},cursor,signal)
        items.push(...page.items.filter(task=>taskMatchesTool(task,[tool])))
        cursor=page.nextCursor??undefined
      } while(cursor&&items.length<2)
      return {items,bound:undefined}
    }})
  useEffect(()=>{
    if(discoveryDone.current||query.isFetching||!sameTaskActor(actor)||current.current.params.has('task')||current.current.nativeBusy||!query.data)return
    if(query.data.items.length===0){discoveryDone.current=true;return}
    if(query.data.items.length!==1)return
    const task=query.data.items[0]
    if(query.data.bound)client.setQueryData(taskCenterKeys.detail(actor,task.taskKey),query.data.bound)
    if(!taskIsActive(task))saveWorkstationSession(actor,tool,{task:undefined})
    discoveryDone.current=true
    const next=new URLSearchParams(current.current.params);next.set('task',task.taskKey);setParams(next,{replace:true})
  },[query.data,query.isFetching,actor,tool,client,setParams])
  useEffect(()=>{
    const input=readWorkstationSession(actor,tool)?.input
    if(!input||current.current.hasDraft||current.current.nativeBusy)return
    const abort=new AbortController()
    void (async()=>{
      const detail=await readTaskDetail(actor,input.sourceKind,input.sourceId,abort.signal)
      if(!taskMatchesTool(detail.task,[tool]))throw new Error('上次输入不属于当前工具')
      const result=detail.results.find(result=>result.kind==='image'&&result.ordinal===input.ordinal)
      if(!result||result.kind==='text')throw new Error('上次输入结果已不可读取')
      const image=await readRecoveryImage(result,actor,abort.signal)
      assertRecoveryActor(actor,abort.signal)
      if(current.current.hasDraft||current.current.nativeBusy)return
      await current.current.onRestoreInput(result,image,detail,{actor,signal:abort.signal})
      if(!abort.signal.aborted)setInputError(undefined)
    })().catch(error=>{if(!abort.signal.aborted&&sameTaskActor(actor))setInputError(error instanceof Error?error.message:'上次输入暂不可读取')})
    return()=>abort.abort()
  },[actor,tool,retry])
  return <>
    {query.error&&!params.has('task')?<Alert type="warning" message="进行中任务暂不可读取" action={<Button onClick={()=>void query.refetch()}>重新查询</Button>}/>:null}
    {!query.isFetching&&!params.has('task')&&query.data&&query.data.items.length>1?<Alert type="info" message="有多项进行中的任务，请选择要查看的一项" action={<Space wrap>{query.data.items.map(task=><Button key={task.taskKey} onClick={()=>{discoveryDone.current=true;const next=new URLSearchParams(params);next.set('task',task.taskKey);setParams(next,{replace:true})}}>{new Date(task.createdAt).toLocaleTimeString()} · {task.completedCount}/{task.requestedCount}</Button>)}<Button onClick={()=>{center?.show(undefined,tool);center?.filter(tool,'active')}}>查看本工具任务</Button></Space>}/>:null}
    {inputError&&!hasDraft?<Alert type="warning" message="上次输入暂不可恢复，请重新读取或选择图片" description={inputError} action={<Button onClick={()=>setRetry(value=>value+1)}>重新读取</Button>}/>:null}
  </>
}
