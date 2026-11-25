import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseCircleOutlined, InfoCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { Button } from 'antd'

export type CanvasNoticeLevel = 'info' | 'warning' | 'error'

export interface CanvasNoticeAction {
  key: string
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

export interface CanvasNotice {
  key: string
  level: CanvasNoticeLevel
  message: string
  description?: string
  actions?: CanvasNoticeAction[]
}

const LEVEL_ICONS = {
  info: <InfoCircleOutlined />,
  warning: <WarningOutlined />,
  error: <CloseCircleOutlined />,
} as const

/**
 * 画布状态条：默认只露出最高优先级的一条，其余折叠成计数。
 * 画布本身是主体，任何状态提示都不该占用整块首屏。
 */
export default function CanvasNoticeBar({ notices }: { notices: CanvasNotice[] }) {
  const { t } = useTranslation('canvas')
  const [expanded, setExpanded] = useState(false)
  if (!notices.length) return null
  const hidden = notices.length - 1
  const visible = expanded ? notices : notices.slice(0, 1)

  return (
    <section className="free-canvas-notices" aria-label={t('noticeBar.aria')}>
      <ul>
        {visible.map((notice) => (
          <li key={notice.key} className={`free-canvas-notice is-${notice.level}`} role="status">
            <span className="free-canvas-notice-icon" aria-hidden="true">{LEVEL_ICONS[notice.level]}</span>
            <div className="free-canvas-notice-copy">
              <strong>{notice.message}</strong>
              {notice.description ? <span title={notice.description}>{notice.description}</span> : null}
            </div>
            {notice.actions?.length ? (
              <div className="free-canvas-notice-actions">
                {notice.actions.map((action) => (
                  <Button
                    key={action.key}
                    size="small"
                    danger={action.danger}
                    disabled={action.disabled}
                    onClick={action.onClick}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          className="free-canvas-notice-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('noticeBar.collapse') : t('noticeBar.more', { count: hidden })}
        </button>
      ) : null}
    </section>
  )
}
