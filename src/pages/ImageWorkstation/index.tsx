import { useNavigate, useParams } from 'react-router-dom'
import { Button } from 'antd'
import ToolSidebar from './components/ToolSidebar'
import CanvasArea from './components/CanvasArea'
import ParamPanel from './components/ParamPanel'
import { WORKSTATION_TOOLS } from './tools'

export default function ImageWorkstation() {
  const { tool } = useParams<{ tool: string }>()
  const navigate = useNavigate()
  const activeTool = WORKSTATION_TOOLS.find((t) => t.slug === tool) ?? WORKSTATION_TOOLS[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <ToolSidebar activeSlug={activeTool.slug} onChange={(slug) => navigate(`/image-workstation/${slug}`)} />
        <CanvasArea interactionMode={activeTool.interactionMode} />
        <div style={{ width: 220 }}>
          <ParamPanel capability={activeTool.key} />
        </div>
      </div>
      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
          {/* TODO: 历史版本缩略图，来自 image_versions 表 */}
          历史版本
        </div>
        <Button type="primary">生成</Button>
      </div>
    </div>
  )
}
