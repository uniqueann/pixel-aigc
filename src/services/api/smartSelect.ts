export interface SmartSelectPayload {
  imageUrl: string
  point: { x: number; y: number }
  canvasSize?: { width: number; height: number }
}

export interface SmartSelectResult {
  maskDataUrl: string
}

/**
 * 智能选区的前端 mock。后端接口就绪后替换为：
 * apiClient.post<unknown, SmartSelectResult>('/smart-select', payload)
 */
export function smartSelect(payload: SmartSelectPayload): Promise<SmartSelectResult> {
  const width = payload.canvasSize?.width ?? 640
  const height = payload.canvasSize?.height ?? 420
  const radius = Math.max(28, Math.min(width, height) * 0.12)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (!context) {
    return Promise.reject(new Error('当前浏览器不支持智能选区'))
  }

  context.fillStyle = '#ffffff'
  context.beginPath()
  context.arc(payload.point.x, payload.point.y, radius, 0, Math.PI * 2)
  context.fill()

  return Promise.resolve({ maskDataUrl: canvas.toDataURL('image/png') })
}
