import { useEffect, useRef, useState } from 'react'
import { Alert } from 'antd'
import { useUserStore } from '@/store/useUserStore'
import { acknowledgeWelcome, readLocalWelcome } from './client'

export default function CreditRulesNotice({ owner }: { owner: string }) {
  const welcome = useUserStore(state => state.account?.welcome)
  const [visible, setVisible] = useState(() => Boolean(welcome && !welcome.creditNoticeSeen && !readLocalWelcome(owner).creditNoticeSeen))
  const acknowledged = useRef(false)
  useEffect(() => {
    if (!visible || acknowledged.current) return
    acknowledged.current = true
    acknowledgeWelcome(owner, { creditNoticeSeen: true })
  }, [owner, visible])
  if (!visible) return null
  const gift = welcome?.initialCredits != null ? `新账号赠送的 ${welcome.initialCredits} 积分已到账；` : ''
  return <Alert className="credit-rules-notice" type="info" showIcon closable
    message={`${gift}生成时先预扣积分，只按成功张数结算，失败或超时自动退回。`}
    onClose={() => setVisible(false)} />
}
