import { z } from 'zod'
import {
  taskSourceKinds,
  taskPresentationSchema,
} from '../../shared/task-center.js'
import { HttpError } from '../errors.js'
import {
  withTaskCenterRead,
  readTaskDetail,
  writePresentation,
  type TaskCenterUser,
} from './service.js'
import { taskSummary } from './repository.js'

export const taskCenterEnabled = () =>
  process.env.TASK_CENTER_ENABLED === 'true'
export async function handleTaskCenterRoute(
  user: TaskCenterUser,
  method: string,
  path: string[],
  body: unknown,
  query: URLSearchParams,
) {
  if (!taskCenterEnabled())
    throw new HttpError(503, '任务中心尚未启用', 'TASK_CENTER_DISABLED')
  if (query.has('scope'))
    throw new HttpError(400, '任务环境由服务端确定', 'INVALID_REQUEST')
  const allowedQuery =
    path.length === 1
      ? ['view', 'tool', 'state', 'limit', 'cursor', '__route']
      : ['__route']
  if ([...query.keys()].some((key) => !allowedQuery.includes(key)))
    throw new HttpError(400, '任务查询参数无效', 'INVALID_REQUEST')
  if (path.length === 1 && method === 'GET') {
    const view = z
      .enum(['sidebar', 'history'])
      .parse(query.get('view') ?? 'sidebar')
    if (view === 'sidebar')
      return withTaskCenterRead(user, (repository) => repository.sidebar())
    return withTaskCenterRead(user, (repository) =>
      repository.history({
        tool: query.get('tool') ?? undefined,
        state: query.get('state') ?? undefined,
        limit: query.get('limit') ?? undefined,
        cursor: query.get('cursor') ?? undefined,
      }),
    )
  }
  if (path.length === 4 && path[1] === 'by-request' && method === 'GET') {
    const kind = z.enum(taskSourceKinds).parse(path[2]),
      id = z.uuid().parse(path[3])
    return withTaskCenterRead(user, async (repository) =>
      taskSummary(await repository.get(kind, id, true)),
    )
  }
  const kind = z.enum(taskSourceKinds).parse(path[1]),
    id = z.uuid().parse(path[2])
  if (path.length === 3 && method === 'GET')
    return readTaskDetail(user, kind, id)
  if (path.length === 4 && path[3] === 'presentation' && method === 'PATCH') {
    const input = taskPresentationSchema.parse(body)
    return writePresentation(user, kind, id, input.action, input.outcomeVersion)
  }
  throw new HttpError(405, '不支持的任务中心操作', 'METHOD_NOT_ALLOWED')
}
