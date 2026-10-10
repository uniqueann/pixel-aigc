import { useState } from 'react'
import { CloseOutlined, PictureOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { Link } from 'react-router-dom'
import { BG_REMOVE_MONTHLY_FREE } from '@shared/billing'
import { useUserStore } from '@/store/useUserStore'
import { acknowledgeWelcome, readLocalWelcome } from '@/features/activation/client'

export default function NewUserCard({ ownerId }: { ownerId: string }) {
  const welcome = useUserStore(state => state.account?.userId === ownerId ? state.account.welcome : undefined)
  const [dismissed, setDismissed] = useState(() => readLocalWelcome(ownerId).starterCardDismissed === true)
  if (!welcome || welcome.initialCredits == null || welcome.hasCreatedWork || welcome.starterCardDismissed || dismissed)
    return <div className="dashboard-empty dashboard-works-empty"><PictureOutlined aria-hidden /><span>还没有最近作品</span></div>
  return <div className="dashboard-new-user-card" role="region" aria-label="开始创作第一张作品">
    <Button className="dashboard-new-user-close" type="text" size="small" icon={<CloseOutlined />} aria-label="关闭新用户卡片"
      onClick={() => { setDismissed(true); acknowledgeWelcome(ownerId, { starterCardDismissed: true }) }} />
    <div><h3>从第一张商品图开始</h3>
      <p>新账号赠送的 {welcome.initialCredits} 积分已到账。推荐先试试智能抠图，每月 {BG_REMOVE_MONTHLY_FREE} 张免费。</p>
    </div>
    <Link className="dashboard-new-user-action" to="/toolbox/bg-remove">开始智能抠图</Link>
  </div>
}
