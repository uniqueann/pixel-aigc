import { useCallback, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { App, Button } from 'antd'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { createTask } from '@/services/api/task'
import { uploadDataUrl } from '@/services/api/upload'
import type { InpaintTaskParams, OutpaintTaskParams } from '@/types'
import CanvasArea, { type CanvasHandle } from './components/CanvasArea'
import type { OutpaintCanvasHandle } from './components/canvas/OutpaintCanvas'
import ParamPanel from './components/ParamPanel'
import ToolSidebar from './components/ToolSidebar'
import { WORKSTATION_TOOLS } from './tools'

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

function isOutpaintHandle(handle: CanvasHandle): handle is OutpaintCanvasHandle {
  return 'getTargetSize' in handle
}

export default function ImageWorkstation() {
  const { tool } = useParams<{ tool: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const canvasHandleRef = useRef<CanvasHandle | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [repaintPrompt, setRepaintPrompt] = useState('')
  const [outpaintMode, setOutpaintMode] = useState<'free' | 'preset'>('free')
  const [presetPlatform, setPresetPlatform] = useState(PLATFORM_SIZE_PRESETS[0].platform)
  const activeTool = WORKSTATION_TOOLS.find((item) => item.slug === tool) ?? WORKSTATION_TOOLS[0]
  const taskQuery = useTaskPolling(activeTaskId)

  const inpaintMode = activeTool.slug === 'repaint' ? 'repaint' : activeTool.slug === 'remove' ? 'remove' : undefined
  const selectedPreset = PLATFORM_SIZE_PRESETS.find((preset) => preset.platform === presetPlatform)
  const presetTargetSize = outpaintMode === 'preset' && selectedPreset
    ? { width: selectedPreset.width, height: selectedPreset.height }
    : undefined

  const handleCanvasReady = useCallback((handle: CanvasHandle | null) => {
    canvasHandleRef.current = handle
  }, [])

  const handleGenerate = async () => {
    const handle = canvasHandleRef.current
    if (!handle) {
      message.info('当前工具的画布交互仍在后续迭代中')
      return
    }
    if (inpaintMode === 'repaint' && !repaintPrompt.trim()) {
      message.warning('请先填写重绘描述')
      return
    }

    setSubmitting(true)
    try {
      const mask = handle.exportMask()
      const maskUrl = await uploadDataUrl(mask.maskDataUrl)
      const requestId = crypto.randomUUID()

      if (isOutpaintHandle(handle)) {
        const params: OutpaintTaskParams = {
          sourceImageUrl: DEMO_IMAGE_URL,
          maskUrl,
          targetSize: handle.getTargetSize(),
          originOffset: handle.getOriginOffset(),
        }
        const task = await createTask<OutpaintTaskParams>({ capability: activeTool.key, requestId, params })
        setActiveTaskId(task.id)
      } else if (inpaintMode) {
        const params: InpaintTaskParams = {
          sourceImageUrl: DEMO_IMAGE_URL,
          maskUrl,
          mode: inpaintMode,
          prompt: inpaintMode === 'repaint' ? repaintPrompt.trim() : undefined,
        }
        const task = await createTask<InpaintTaskParams>({ capability: activeTool.key, requestId, params })
        setActiveTaskId(task.id)
      }

      message.success('任务已提交')
    } catch (error) {
      const description = error instanceof Error ? error.message : '请检查 API 服务是否已启动'
      message.error({ content: `任务提交失败：${description}`, duration: 4 })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <ToolSidebar activeSlug={activeTool.slug} onChange={(slug) => navigate(`/image-workstation/${slug}`)} />
        <CanvasArea
          interactionMode={activeTool.interactionMode}
          imageUrl={DEMO_IMAGE_URL}
          imageNaturalSize={DEMO_IMAGE_SIZE}
          presetTargetSize={presetTargetSize}
          onReady={handleCanvasReady}
        />
        <div style={{ width: 220, flexShrink: 0 }}>
          <ParamPanel
            capability={activeTool.key}
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
          {taskQuery.data ? `任务状态：${taskQuery.data.status}` : '历史版本'}
        </div>
        <Button type="primary" loading={submitting} onClick={handleGenerate}>
          生成
        </Button>
      </div>
    </div>
  )
}
