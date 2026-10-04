import { useEffect, useRef, useState } from 'react'
import { Modal } from 'antd'
import { SPEND_CONFIRM_EVENT, type SpendConfirmation } from '@/services/api/billing'
import { useUserStore } from '@/store/useUserStore'
import { SYNC_TOOL_LABELS } from '@shared/billing'

export default function CreditSpendGate() {
  const owner=useUserStore(state=>state.userId)
  const [pending,setPending]=useState<SpendConfirmation[]>([])
  const requests=useRef(new Set<SpendConfirmation>())
  useEffect(()=>{
    const queue=requests.current
    const receive=(event:Event)=>{
      const next=(event as CustomEvent<SpendConfirmation>).detail
      if (next.owner!==owner) { next.resolve(false); return }
      queue.add(next); setPending(current=>[...current,next])
    }
    window.addEventListener(SPEND_CONFIRM_EVENT,receive)
    return ()=>{ window.removeEventListener(SPEND_CONFIRM_EVENT,receive); queue.forEach(item=>item.resolve(false));queue.clear(); setPending([]) }
  },[owner])
  const current=pending[0]
  const finish=(approved:boolean)=>{
    if(current) {requests.current.delete(current);current.resolve(approved)}
    setPending(items=>items.slice(1))
  }
  return <Modal open={Boolean(current)} title={`确认${current ? SYNC_TOOL_LABELS[current.operation] : ''}费用`}
    okText="确认并处理" cancelText="取消" onOk={()=>finish(true)} onCancel={()=>finish(false)}>
    {current ? <>
      <p>{current.operation === 'outpaint' && current.required===10 ? '扩图按实际轮次收取 5／10 积分，本次最多预扣 10 积分。' : `本次使用 ${current.required} 积分。`}</p>
      <p>当前余额 {current.balance} 积分。成功后结算，失败或超时自动退回。</p>
    </> : null}
  </Modal>
}
