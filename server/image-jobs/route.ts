import { z } from 'zod'
import type { authenticate } from '../auth.js'
import { HttpError } from '../errors.js'
import {
  deleteImageTask,
  listImageTasks,
  loadImageTask,
  loadImageTaskByRequest,
  peekImageTask,
  submitImageTask,
} from './service.js'

export { peekImageTask }

type User = Awaited<ReturnType<typeof authenticate>>
const uuid = z.uuid()

export async function handleImageTaskRoute(user: User, method: string, path: string[], body: unknown, query: URLSearchParams) {
  if (path.length === 1 && method === 'POST') {
    if (body && typeof body === 'object' && 'capability' in body && body.capability === 'text_to_video') {
      const { submitVideoTask } = await import('../video-jobs/service.js')
      return submitVideoTask(user, body)
    }
    return submitImageTask(user, body)
  }
  if (path.length === 1 && method === 'GET') {
    const page = z.coerce.number().int().min(1).max(1000).parse(query.get('page') ?? '1')
    const capability = query.has('capability')
      ? z.enum(['image_edit', 'variation', 'text_to_image', 'text_to_video']).parse(query.get('capability'))
      : undefined
    return listImageTasks(user, page, capability)
  }
  if (path[1] === 'by-request' && path.length === 3 && method === 'GET') {
    return loadImageTaskByRequest(user, uuid.parse(path[2]))
  }
  if (path.length === 2) {
    const id = uuid.parse(path[1])
    if (method === 'GET') return loadImageTask(user, id)
    if (method === 'DELETE') return deleteImageTask(user, id)
  }
  throw new HttpError(404, '接口不存在', 'NOT_FOUND')
}
