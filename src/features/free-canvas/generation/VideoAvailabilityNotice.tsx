import { Button } from 'antd'
import type { CapabilityAvailability } from '@/components/capabilityAvailability'

export default function VideoAvailabilityNotice({ state, onRetry }: { state: CapabilityAvailability; onRetry?: () => void }) {
  if (state === 'ready') return null
  if (state === 'soon') return <p role="status">视频生成即将上线。</p>
  if (state === 'error') return <p role="alert">视频功能加载失败，请重试。{onRetry ? <Button size="small" onClick={onRetry}>重试加载视频功能</Button> : null}</p>
  return <p role="status">正在加载视频功能…</p>
}
