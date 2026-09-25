import { lazy, Suspense } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Segmented } from 'antd'
import { liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'
import { TOOLBOX_TOOLS } from './tools'

const WatermarkTool = lazy(() => import('./WatermarkTool'))
const AspectRatioTool = lazy(() => import('./AspectRatioTool'))
const BgRemoveTool = lazy(() => import('./BgRemoveTool'))

export default function Toolbox() {
  const { tool } = useParams<{ tool: string }>()
  const navigate = useNavigate()
  const activeSlug = TOOLBOX_TOOLS.find((t) => t.slug === tool)?.slug ?? TOOLBOX_TOOLS[0].slug

  return (
    <div>
      <Segmented
        options={TOOLBOX_TOOLS.map((t) => ({
          label: t.slug === 'bg-remove' && !liveCapabilityReady(Capability.BgRemove) ? '智能抠图 · 即将上线' : t.label,
          value: t.slug,
        }))}
        value={activeSlug}
        onChange={(v) => navigate(`/toolbox/${v}`)}
      />

      {activeSlug === 'bg-remove' ? <Suspense fallback={<div style={{ marginTop: 20 }}>正在加载智能抠图…</div>}><BgRemoveTool /></Suspense> : activeSlug === 'watermark' ? <Suspense fallback={<div style={{ marginTop: 20 }}>正在加载加水印工具…</div>}><WatermarkTool /></Suspense> : activeSlug === 'aspect-ratio' ? <Suspense fallback={<div style={{ marginTop: 20 }}>正在加载转比例工具…</div>}><AspectRatioTool /></Suspense> : null}
    </div>
  )
}
