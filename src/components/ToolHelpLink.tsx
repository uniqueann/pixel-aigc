import { QuestionCircleOutlined } from '@ant-design/icons'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function ToolHelpLink() {
  const { t } = useTranslation('common')
  const { pathname } = useLocation()
  const group = pathname.split('/')[1]
  const href = group === 'image-workstation' ? '/help/workstation'
    : group === 'email' ? '/help/email-assistant'
    : group === 'toolbox' ? pathname === '/toolbox/bg-remove' ? '/help/bg-remove' : '/help/toolbox'
    : group === 'canvas' ? '/help/canvas' : undefined
  if (!href) return null
  // 新标签打开帮助，避免离开工作站丢失上传图和备注。
  return <Link className="tool-help-link" to={href} target="_blank" rel="noreferrer" aria-label={t('controls.helpLinkAria')} title={t('controls.helpLinkTitle')}><QuestionCircleOutlined /></Link>
}
