import { Suspense } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ToolSwitcher from '@/components/ToolSwitcher'
import { useCapabilities } from '@/hooks/useCapabilities'
import { lazyWithRetry } from '@/utils/lazyWithRetry'
import { TOOLBOX_TOOLS } from './tools'

const WatermarkTool = lazyWithRetry(() => import('./WatermarkTool'))
const AspectRatioTool = lazyWithRetry(() => import('./AspectRatioTool'))
const BgRemoveTool = lazyWithRetry(() => import('./BgRemoveTool'))

export default function Toolbox() {
  const { tool } = useParams<{ tool: string }>()
  const navigate = useNavigate()
  const activeSlug = TOOLBOX_TOOLS.find((t) => t.slug === tool)?.slug ?? TOOLBOX_TOOLS[0].slug
  const { capabilities: { bgRemove: bgRemoveReady } } = useCapabilities()

  return (
    <div>
      <ToolSwitcher
        options={TOOLBOX_TOOLS.map((t) => ({
          value: t.slug,
          label: t.label,
          ready: t.slug === 'bg-remove' ? bgRemoveReady : true,
        }))}
        value={activeSlug}
        onChange={(slug) => navigate(`/toolbox/${slug}`)}
      />

      {activeSlug === 'bg-remove' ? <Suspense fallback={<div style={{ marginTop: 20 }}>正在加载智能抠图…</div>}><BgRemoveTool /></Suspense> : activeSlug === 'watermark' ? <Suspense fallback={<div style={{ marginTop: 20 }}>正在加载加水印工具…</div>}><WatermarkTool /></Suspense> : activeSlug === 'aspect-ratio' ? <Suspense fallback={<div style={{ marginTop: 20 }}>正在加载转比例工具…</div>}><AspectRatioTool /></Suspense> : null}
    </div>
  )
}
