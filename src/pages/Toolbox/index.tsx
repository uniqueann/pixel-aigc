import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import ToolSwitcher from '@/components/ToolSwitcher'
import { useCapabilities } from '@/hooks/useCapabilities'
import { lazyWithRetry } from '@/utils/lazyWithRetry'
import { getToolboxToolLabel, TOOLBOX_TOOLS } from './tools'

const WatermarkTool = lazyWithRetry(() => import('./WatermarkTool'))
const AspectRatioTool = lazyWithRetry(() => import('./AspectRatioTool'))
const BgRemoveTool = lazyWithRetry(() => import('./BgRemoveTool'))
const PipelineTool = lazyWithRetry(() => import('./PipelineTool'))

export default function Toolbox() {
  const { t } = useTranslation('toolbox')
  const { tool } = useParams<{ tool: string }>()
  const navigate = useNavigate()
  const activeSlug = TOOLBOX_TOOLS.find((item) => item.slug === tool)?.slug ?? TOOLBOX_TOOLS[0].slug
  const { capabilities: { bgRemove: bgRemoveReady } } = useCapabilities()

  return (
    <div className="toolbox-page">
      <ToolSwitcher
        className="toolbox-tool-switcher page-tab-row"
        options={TOOLBOX_TOOLS.map((item) => ({
          value: item.slug,
          label: getToolboxToolLabel(item.slug),
          ready: item.slug === 'bg-remove' ? bgRemoveReady : true,
        }))}
        value={activeSlug}
        onChange={(slug) => navigate(`/toolbox/${slug}`)}
      />

      {activeSlug === 'bg-remove' ? (
        <Suspense fallback={<div>{t('loading.bg-remove')}</div>}><BgRemoveTool /></Suspense>
      ) : activeSlug === 'watermark' ? (
        <Suspense fallback={<div>{t('loading.watermark')}</div>}><WatermarkTool /></Suspense>
      ) : activeSlug === 'aspect-ratio' ? (
        <Suspense fallback={<div>{t('loading.aspect-ratio')}</div>}><AspectRatioTool /></Suspense>
      ) : activeSlug === 'pipeline' ? (
        <Suspense fallback={<div>{t('loading.pipeline')}</div>}><PipelineTool /></Suspense>
      ) : null}
    </div>
  )
}
