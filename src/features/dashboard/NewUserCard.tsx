import { useState } from 'react'
import { CloseOutlined, PictureOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BG_REMOVE_MONTHLY_FREE } from '@shared/billing'
import { useUserStore } from '@/store/useUserStore'
import { acknowledgeWelcome, readLocalWelcome } from '@/features/activation/client'

export default function NewUserCard({ ownerId }: { ownerId: string }) {
  const { t } = useTranslation('dashboard')
  const welcome = useUserStore(state => state.account?.userId === ownerId ? state.account.welcome : undefined)
  const [dismissed, setDismissed] = useState(() => readLocalWelcome(ownerId).starterCardDismissed === true)
  if (!welcome || welcome.initialCredits == null || welcome.hasCreatedWork || welcome.starterCardDismissed || dismissed)
    return <div className="dashboard-works-empty">
      <PictureOutlined aria-hidden />
      <div className="dashboard-works-empty-copy"><strong>{t('emptyWorks.title')}</strong><span>{t('emptyWorks.subtitle')}</span></div>
      <Link className="dashboard-works-empty-action" to="/canvas/text-to-image">{t('emptyWorks.action')}</Link>
    </div>
  return <div className="dashboard-new-user-card" role="region" aria-label={t('newUserCard.regionAria')}>
    <Button className="dashboard-new-user-close" type="text" size="small" icon={<CloseOutlined />} aria-label={t('newUserCard.closeAria')}
      onClick={() => { setDismissed(true); acknowledgeWelcome(ownerId, { starterCardDismissed: true }) }} />
    <div><h3>{t('newUserCard.title')}</h3>
      <p>{t('newUserCard.description', { credits: welcome.initialCredits, freeCount: BG_REMOVE_MONTHLY_FREE })}</p>
    </div>
    <Link className="dashboard-new-user-action" to="/toolbox/bg-remove">{t('newUserCard.action')}</Link>
  </div>
}
