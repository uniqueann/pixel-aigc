import { AppstoreOutlined, BgColorsOutlined, MailOutlined, PictureOutlined, RightOutlined } from '@ant-design/icons'
import { Alert, Button } from 'antd'
import { Link } from 'react-router-dom'
import { useCapabilities } from '@/hooks/useCapabilities'
import { QUICK_START_GROUPS, entryReady, type QuickStartEntry } from './catalog'

const icons = { image: <PictureOutlined />, batch: <AppstoreOutlined />, generate: <BgColorsOutlined />, email: <MailOutlined /> }

export function ToolEntry({ entry, ready, error, recent = false }: { entry: QuickStartEntry; ready: boolean | undefined; error?: boolean; recent?: boolean }) {
  const contents = <><span>{entry.label}</span>{ready === true ? <RightOutlined aria-hidden />
    : <small>{ready === false ? '即将上线' : error ? '加载失败' : '加载中…'}</small>}</>
  return ready === true
    ? <Link className="dashboard-tool-link" to={entry.href} aria-label={`${recent ? '继续使用' : '打开'}${entry.label}`}>{contents}</Link>
    : <span className="dashboard-tool-link is-unavailable" aria-disabled="true">{contents}</span>
}

export default function QuickStart() {
  const { capabilities, error, refetch } = useCapabilities()
  return <section className="dashboard-section" aria-labelledby="dashboard-quick-title">
    <div className="dashboard-section-heading"><h2 id="dashboard-quick-title">快速开始</h2><span>选择一个工具，开始工作</span></div>
    {error ? <Alert type="warning" showIcon message="功能配置加载失败"
      action={<Button size="small" onClick={() => void refetch()}>重试配置</Button>} /> : null}
    <div className="dashboard-quick-grid">
      {QUICK_START_GROUPS.map(group => <div className="dashboard-panel dashboard-quick-panel" key={group.id}>
        <div className="dashboard-group-heading"><span className="dashboard-entry-icon" aria-hidden>{icons[group.id as keyof typeof icons]}</span>
          <div><h3>{group.title}</h3><p>{group.description}</p></div>
        </div>
        <div className="dashboard-tool-list">{group.entries.map(entry => <ToolEntry key={entry.href} entry={entry} ready={entryReady(entry, capabilities)} error={Boolean(error)} />)}</div>
      </div>)}
    </div>
  </section>
}
