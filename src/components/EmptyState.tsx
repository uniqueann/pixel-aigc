import { Empty } from 'antd'
import type { ReactNode } from 'react'

interface Props {
  description: string
  action?: ReactNode
}

export default function EmptyState({ description, action }: Props) {
  return (
    <div style={{ padding: '48px 0', textAlign: 'center' }}>
      <Empty description={description} />
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  )
}
