import { useCallback, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { App, Button } from 'antd'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { createImageAsset } from '@/editor/services/assetService'
import { useImageWorkstationController } from '@/features/image-workstation/hooks/useImageWorkstationController'
import { getWorkstationTool } from '@/features/image-workstation/tools/registry'
import CanvasArea, { type CanvasHandle } from './components/CanvasArea'
import ParamPanel from './components/ParamPanel'
import ToolSidebar from './components/ToolSidebar'

const DEMO_IMAGE_SIZE = { width: 1280, height: 960 }
const DEMO_IMAGE_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960" viewBox="0 0 1280 960">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop stop-color="#e7ecea"/>
        <stop offset="1" stop-color="#b8c9c3"/>
      </linearGradient>
      <linearGradient id="product" x1="0" x2="1">
        <stop stop-color="#153e35"/>
        <stop offset="1" stop-color="#21cfa0"/>
      </linearGradient>
    </defs>
    <rect width="1280" height="960" fill="url(#bg)"/>
    <ellipse cx="640" cy="760" rx="330" ry="55" fill="#587069" opacity=".28"/>
    <rect x="430" y="210" width="420" height="520" rx="70" fill="url(#product)"/>
    <rect x="485" y="275" width="310" height="310" rx="34" fill="#f6faf8" opacity=".92"/>
    <circle cx="640" cy="430" r="92" fill="#d9eee7"/>
    <path d="M588 430h104M640 378v104" stroke="#17745f" stroke-width="24" stroke-linecap="round"/>
    <text x="640" y="665" text-anchor="middle" font-family="sans-serif" font-size="44" fill="#ffffff">DEMO PRODUCT</text>
  </svg>
`
const DEMO_IMAGE_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DEMO_IMAGE_SVG)}`
const DEMO_IMAGE_ASSET = createImageAsset({
  id: 'asset:demo-image',
  name: '示例商品图',
  url: DEMO_IMAGE_URL,
  ...DEMO_IMAGE_SIZE,
})

export default function ImageWorkstation() {
  const { tool } = useParams<{ tool: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const canvasHandleRef = useRef<CanvasHandle | null>(null)
  const [repaintPrompt, setRepaintPrompt] = useState('')
  const [outpaintMode, setOutpaintMode] = useState<'free' | 'preset'>('free')
  const [presetPlatform, setPresetPlatform] = useState(PLATFORM_SIZE_PRESETS[0].platform)
  const activeTool = getWorkstationTool(tool)
  const controller = useImageWorkstationController({ activeTool, initialAsset: DEMO_IMAGE_ASSET, prompt: repaintPrompt })

  const inpaintMode = activeTool.slug === 'repaint' ? 'repaint' : activeTool.slug === 'remove' ? 'remove' : undefined
  const selectedPreset = PLATFORM_SIZE_PRESETS.find((preset) => preset.platform === presetPlatform)
  const presetTargetSize = outpaintMode === 'preset' && selectedPreset
    ? { width: selectedPreset.width, height: selectedPreset.height }
    : undefined

  const handleCanvasReady = useCallback((handle: CanvasHandle | null) => {
    canvasHandleRef.current = handle
  }, [])

  const handleGenerate = async () => {
    try {
      await controller.generate(canvasHandleRef.current)
      message.success('任务已提交')
    } catch (error) {
      const description = error instanceof Error ? error.message : '请检查 API 服务是否已启动'
      message.error({ content: `任务提交失败：${description}`, duration: 4 })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <ToolSidebar activeSlug={activeTool.slug} onChange={(slug) => navigate(`/image-workstation/${slug}`)} />
        <CanvasArea
          interactionMode={activeTool.interactionMode}
          imageUrl={controller.inputAsset.url}
          imageNaturalSize={{ width: controller.inputAsset.width, height: controller.inputAsset.height }}
          presetTargetSize={presetTargetSize}
          onReady={handleCanvasReady}
        />
        <div style={{ width: 220, flexShrink: 0 }}>
          <ParamPanel
            capability={activeTool.capability}
            mode={inpaintMode}
            repaintPrompt={repaintPrompt}
            onRepaintPromptChange={setRepaintPrompt}
            outpaintMode={outpaintMode}
            onOutpaintModeChange={setOutpaintMode}
            presetPlatform={presetPlatform}
            onPresetPlatformChange={setPresetPlatform}
          />
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
          {controller.activeTask ? `任务状态：${controller.activeTask.status}` : '历史版本'}
        </div>
        <Button type="primary" loading={controller.submitting} onClick={handleGenerate}>
          生成
        </Button>
      </div>
    </div>
  )
}
