import { Tooltip } from 'antd'
import { COMING_SOON_LABEL, WORKSTATION_TOOLS, isWorkstationToolReady } from '../tools'

interface Props {
  activeSlug: string
  onChange: (slug: string) => void
}

export default function ToolSidebar({ activeSlug, onChange }: Props) {
  return (
    <div className="workstation-tool-rail">
      {WORKSTATION_TOOLS.map((tool) => {
        const ready = isWorkstationToolReady(tool)
        const title = ready ? tool.label : `${tool.label} · ${COMING_SOON_LABEL}`
        return (
          <Tooltip key={tool.slug} title={title} placement="right">
            <button
              type="button"
              className={`workstation-tool-button${tool.slug === activeSlug ? ' is-active' : ''}${ready ? '' : ' is-coming-soon'}`}
              onClick={() => onChange(tool.slug)}
            >
              <span>{tool.label}</span>
              {ready ? null : <span className="workstation-tool-badge">{COMING_SOON_LABEL}</span>}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
