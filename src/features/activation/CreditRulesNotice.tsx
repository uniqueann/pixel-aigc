import { useEffect, useRef, useState } from 'react'
import { Alert } from 'antd'
import { useTranslation } from 'react-i18next'
import { useUserStore } from '@/store/useUserStore'
import { acknowledgeWelcome, readLocalWelcome } from './client'

export default function CreditRulesNotice({ owner }: { owner: string }) {
  const { t } = useTranslation('credits')
  const welcome = useUserStore(state => state.account?.welcome)
  const [visible, setVisible] = useState(() => Boolean(welcome && !welcome.creditNoticeSeen && !readLocalWelcome(owner).creditNoticeSeen))
  const acknowledged = useRef(false)
  useEffect(() => {
    if (!visible || acknowledged.current) return
    acknowledged.current = true
    acknowledgeWelcome(owner, { creditNoticeSeen: true })
  }, [owner, visible])
  if (!visible) return null
  const gift = welcome?.initialCredits != null ? t('rulesNotice.gift', { credits: welcome.initialCredits }) : ''
  return <Alert className="credit-rules-notice" type="info" showIcon closable
    message={t('rulesNotice.body', { gift })}
    onClose={() => setVisible(false)} />
}
