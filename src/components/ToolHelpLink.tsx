import { QuestionCircleOutlined } from '@ant-design/icons'
import { Link, useLocation } from 'react-router-dom'

export default function ToolHelpLink() {
  const { pathname } = useLocation()
  const group = pathname.split('/')[1]
  const href = group === 'image-workstation' ? '/help/workstation'
    : group === 'email' ? '/help/email-assistant'
    : group === 'toolbox' ? pathname === '/toolbox/bg-remove' ? '/help/bg-remove' : '/help/toolbox'
    : group === 'canvas' ? '/help/canvas' : undefined
  if (!href) return null
  return <Link className="tool-help-link" to={href} aria-label="当前工具使用帮助" title="使用帮助"><QuestionCircleOutlined /></Link>
}
