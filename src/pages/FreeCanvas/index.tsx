import { useNavigate, useParams } from 'react-router-dom'
import { Button, Input, Segmented } from 'antd'
import { CANVAS_MODES } from './modes'

export default function FreeCanvas() {
  const { mode } = useParams<{ mode: string }>()
  const navigate = useNavigate()
  const activeSlug = CANVAS_MODES.find((m) => m.slug === mode)?.slug ?? CANVAS_MODES[0].slug

  return (
    <div>
      <Segmented
        options={CANVAS_MODES.map((m) => ({ label: m.label, value: m.slug }))}
        value={activeSlug}
        onChange={(v) => navigate(`/canvas/${v}`)}
      />
      <div style={{ marginTop: 16, display: 'flex', gap: 16 }}>
        <div
          style={{
            flex: 1,
            minHeight: 400,
            border: '1px dashed var(--color-border-strong)',
            borderRadius: 10,
            background: 'var(--color-canvas)',
          }}
        >
          {/* TODO: 自由画布，支持多次生成结果自由排布、拖拽比较 */}
        </div>
        <div style={{ width: 260 }}>
          <Input.TextArea rows={6} placeholder="描述你想生成的画面" />
          {/* TODO: 参考图上传、比例选择、（文生视频）时长选择 */}
          <Button type="primary" style={{ marginTop: 12, width: '100%' }}>
            生成
          </Button>
        </div>
      </div>
    </div>
  )
}
