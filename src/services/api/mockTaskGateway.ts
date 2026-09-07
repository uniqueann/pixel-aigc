import { Capability, type GenerationTask, type TextToImageTaskParams } from '@/types'
import type { CreateTaskPayload } from './task'

interface MockTaskRecord {
  task: GenerationTask<unknown>
  pollCount: number
}

const tasks = new Map<string, MockTaskRecord>()

export async function createMockTask<TParams>(payload: CreateTaskPayload<TParams>): Promise<GenerationTask<TParams>> {
  const timestamp = new Date().toISOString()
  const task: GenerationTask<TParams> = {
    id: `mock:${payload.requestId}`,
    capability: payload.capability,
    status: 'queued',
    params: payload.params,
    creditsCost: readCount(payload.params),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  tasks.set(task.id, { task: task as GenerationTask<unknown>, pollCount: 0 })
  return task
}

export async function getMockTask(taskId: string): Promise<GenerationTask<unknown>> {
  const record = tasks.get(taskId)
  if (!record) throw new Error('模拟任务不存在')

  record.pollCount += 1
  const status = record.pollCount >= 2 ? 'succeeded' : 'processing'
  record.task = {
    ...record.task,
    status,
    resultUrls: status === 'succeeded' ? createResultUrls(record.task) : undefined,
    updatedAt: new Date().toISOString(),
  }
  return record.task
}

export async function listMockTasks() {
  const items = Array.from(tasks.values(), ({ task }) => task)
  return { items, total: items.length }
}

export async function cancelMockTask(taskId: string) {
  const record = tasks.get(taskId)
  if (!record) return
  record.task = { ...record.task, status: 'cancelled', updatedAt: new Date().toISOString() }
}

export function resetMockTasks() {
  tasks.clear()
}

function readCount(params: unknown) {
  if (!params || typeof params !== 'object' || !('count' in params)) return 1
  const count = Number(params.count)
  return Number.isFinite(count) ? Math.min(4, Math.max(1, Math.round(count))) : 1
}

function createResultUrls(task: GenerationTask<unknown>) {
  if (task.capability === Capability.TextToImage) {
    const params = task.params as unknown as TextToImageTaskParams
    return Array.from({ length: readCount(params) }, (_, index) => createMockImage(params, index))
  }

  if (task.params && typeof task.params === 'object' && 'sourceImageUrl' in task.params) {
    const sourceImageUrl = task.params.sourceImageUrl
    return typeof sourceImageUrl === 'string' ? [sourceImageUrl] : []
  }
  return []
}

function createMockImage(params: TextToImageTaskParams, index: number) {
  const { width, height } = params.size
  const palettes = [
    ['#0f3d35', '#21cfa0'],
    ['#283048', '#859398'],
    ['#4b134f', '#c94b4b'],
    ['#1d4350', '#a43931'],
  ]
  const [start, end] = palettes[index % palettes.length]
  const prompt = escapeSvgText(params.prompt.trim().slice(0, 42) || 'Pixel AIGC')
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs>
      <rect width="${width}" height="${height}" fill="url(#g)"/>
      <circle cx="${width * 0.72}" cy="${height * 0.28}" r="${Math.min(width, height) * 0.16}" fill="#fff" opacity=".14"/>
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="sans-serif" font-size="${Math.max(24, Math.min(width, height) * 0.055)}" fill="#fff">${prompt}</text>
      <text x="${width / 2}" y="${height / 2 + Math.max(40, Math.min(width, height) * 0.08)}" text-anchor="middle" font-family="sans-serif" font-size="${Math.max(16, Math.min(width, height) * 0.025)}" fill="#fff" opacity=".7">MOCK RESULT ${index + 1}</text>
    </svg>
  `
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function escapeSvgText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] ?? character)
}
