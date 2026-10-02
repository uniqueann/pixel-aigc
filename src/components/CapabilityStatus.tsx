import { Button } from 'antd'

interface Props {
  ready: boolean | undefined
  error?: Error | null
  unavailableMessage: string
  onRetry: () => void
}

export default function CapabilityStatus({ ready, error, unavailableMessage, onRetry }: Props) {
  if (ready === true) return null
  if (ready === false) return <p className="toolbox-hint toolbox-warning">{unavailableMessage}</p>
  if (error) return <p className="toolbox-hint" role="alert">
    功能配置加载失败，请重试。<Button size="small" onClick={onRetry}>重试</Button>
  </p>
  return <p className="toolbox-hint" role="status">正在加载功能配置…</p>
}
