import { Tooltip } from 'antd'
import { WORKSTATION_TOOLS } from '../tools'

interface Props {
  activeSlug: string
  onChange: (slug: string) => void
}

export default function ToolSidebar({ activeSlug, onChange }: Props) {
  return (
    <div style={{ width: 64, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {WORKSTATION_TOOLS.map((tool) => (
        <Tooltip key={tool.slug} title={tool.label} placement="right">
          <button
            onClick={() => onChange(tool.slug)}
            style={{
              height: 48,
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              background: tool.slug === activeSlug ? 'var(--color-accent-soft)' : 'var(--color-surface)',
              color: tool.slug === activeSlug ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {tool.label}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}
