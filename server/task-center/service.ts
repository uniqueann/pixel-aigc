import type {
  TaskCenterDetail,
  TaskCenterMedia,
  TaskScope,
  TaskSourceKind,
} from '../../shared/task-center.js'
import {
  database,
  runtimeScope,
  withIdentity,
  type Transaction,
} from '../db.js'
import { requireActive } from '../members.js'
import { signRead, headObject } from '../storage.js'
import { isSafeObjectKey } from '../image-jobs/service.js'
import { taskRepository, taskSummary, type TaskQuery } from './repository.js'

export interface TaskCenterUser {
  id: string
  email: string
}
export function queryPort(sql: Transaction): TaskQuery {
  return {
    query: async (statement, parameters = []) =>
      (await sql.unsafe(statement, parameters as never[])) as unknown as Record<
        string,
        unknown
      >[],
  }
}

/** 数据库强制只读和同一快照；签名、对象检查均在事务结束后执行。 */
export async function withTaskCenterRead<T>(
  user: TaskCenterUser,
  action: (repository: ReturnType<typeof taskRepository>) => Promise<T>,
): Promise<T> {
  return database().begin(
    'isolation level repeatable read read only',
    async (sql) => {
      await sql`set local role aigc_api`
      await sql`select set_config('aigc.user_id',${user.id},true),set_config('aigc.email',${user.email},true),set_config('aigc.scope',${runtimeScope()},true)`
      await sql`select set_config('statement_timeout','8000',true),set_config('lock_timeout','5000',true)`
      await requireActive(sql, user.id)
      return action(taskRepository(queryPort(sql), user.id, runtimeScope()))
    },
  ) as Promise<T>
}

export interface TaskDetailSnapshot {
  task: ReturnType<typeof taskSummary>
  native: Record<string, unknown>
  items: Record<string, unknown>[]
  children?: TaskCenterDetail['children']
}
export async function detailSnapshot(
  db: TaskQuery,
  owner: string,
  scope: TaskScope,
  kind: TaskSourceKind,
  id: string,
): Promise<TaskDetailSnapshot> {
  const repository = taskRepository(db, owner, scope)
  const task = taskSummary(await repository.get(kind, id))
  const native = await repository.native(kind, id)
  const items =
    kind === 'image_job'
      ? await db.query(
          'select * from aigc.image_job_items where user_id=$1::uuid and scope=$2 and job_id=$3::uuid order by ordinal',
          [owner, scope, id],
        )
      : []
  return { task, native, items, ...(kind === 'suite_batch' ? { children: await repository.batchChildren(id) } : {}) }
}

export async function presentTaskDetail(
  snapshot: TaskDetailSnapshot,
  owner: string,
  storage = { head: headObject, sign: signRead, safe: isSafeObjectKey },
): Promise<TaskCenterDetail> {
  const { task, native, items } = snapshot
  if (task.sourceKind === 'suite_batch') return {
    task, params: { projectId: task.suite?.projectId },
    errorMessage: (native.snapshot as { blockedReason?: string | null }).blockedReason ?? null,
    results: [], children: snapshot.children ?? [],
  }
  if (task.sourceKind === 'email_task')
    return {
      task,
      params: native.params as Record<string, unknown>,
      errorMessage: native.error_message as string | null,
      results: native.result_text
        ? [
            {
              kind: 'text',
              text: String(native.result_text),
              editedText: native.edited_text as string | null,
            },
          ]
        : [],
    }
  const references =
    task.sourceKind === 'sync_credit'
      ? native.result
        ? [{ ...(native.result as Record<string, unknown>), ordinal: 0 }]
        : []
      : items
          .filter(
            (item) => item.status === 'succeeded' && item.result_object_key,
          )
          .map((item) => ({
            ordinal: item.ordinal,
            objectKey: item.result_object_key,
            mimeType: item.result_mime_type,
            width: item.result_width,
            height: item.result_height,
            metadata: item.result_metadata,
          }))
  const results: TaskCenterMedia[] = await Promise.all(
    references.map(async (raw) => {
      const reference = raw as Record<string, unknown>,
        key = String(reference.objectKey ?? '')
      const media: TaskCenterMedia = {
        kind: task.capability === 'text_to_video' ? 'video' : 'image',
        ordinal: Number(reference.ordinal),
        objectKey: key,
        mimeType: String(reference.mimeType ?? 'image/png'),
        width: Number(reference.width ?? 0),
        height: Number(reference.height ?? 0),
        url: '',
        urlExpiresAt: '',
        availability: 'unavailable',
      }
      if (media.kind === 'video') {
        const meta = (reference.metadata ?? {}) as Record<string, unknown>
        if (typeof meta.durationSeconds === 'number' && typeof meta.sizeBytes === 'number' && typeof meta.hasAudio === 'boolean' && task.resultExpiresAt) {
          media.video = { durationSeconds: meta.durationSeconds, sizeBytes: meta.sizeBytes, hasAudio: meta.hasAudio,
            posterKey: typeof meta.posterKey === 'string' && storage.safe(owner,meta.posterKey) ? meta.posterKey : undefined,
            retentionExpiresAt: task.resultExpiresAt }
        }
      }
      if (!storage.safe(owner, key)) return { ...media, objectKey: '' }
      if (task.resultAvailability === 'expired')
        return { ...media, availability: 'expired' }
      try {
        await storage.head(key)
        const ttl = task.resultExpiresAt
          ? Math.min(
              900,
              Math.floor(
                (new Date(task.resultExpiresAt).getTime() - Date.now()) / 1000,
              ),
            )
          : 900
        if (ttl < 1) return { ...media, availability: 'expired' }
        const signed = await storage.sign(key, ttl)
        return {
          ...media,
          url: signed.url,
          urlExpiresAt: new Date(signed.expiresAt).toISOString(),
          availability: 'available',
        }
      } catch {
        return media
      }
    }),
  )
  return {
    task: {
      ...task,
      resultAvailability: results.some(
        (result) => result.availability === 'available',
      )
        ? 'available'
        : results.length
          ? results.every((result) => result.availability === 'expired')
            ? 'expired'
            : 'unavailable'
          : task.resultAvailability,
    },
    params:
      task.sourceKind === 'sync_credit'
        ? null
        : (native.params as Record<string, unknown>),
    errorMessage: (native.error_message ?? native.error_code ?? null) as
      string | null,
    results,
  }
}

export async function readTaskDetail(
  user: TaskCenterUser,
  kind: TaskSourceKind,
  id: string,
) {
  const snapshot = await withTaskCenterRead(user, (repository) =>
    detailSnapshotFromRepository(repository, kind, id),
  )
  return presentTaskDetail(snapshot, user.id)
}

async function detailSnapshotFromRepository(
  repository: ReturnType<typeof taskRepository>,
  kind: TaskSourceKind,
  id: string,
) {
  const task = taskSummary(await repository.get(kind, id)),
    native = await repository.native(kind, id)
  // 该调用仍在外层同一只读快照中，使用当前事务的接口读取明细。
  const items = await repository.items(kind, id)
  return { task, native, items, ...(kind === 'suite_batch' ? { children: await repository.batchChildren(id) } : {}) }
}

export function writePresentation(
  user: TaskCenterUser,
  kind: TaskSourceKind,
  id: string,
  action: 'seen' | 'dismiss',
  version: string,
) {
  return withIdentity(user.id, user.email, async (sql) => {
    await sql`select set_config('statement_timeout','8000',true),set_config('lock_timeout','5000',true)`
    await requireActive(sql, user.id)
    return taskRepository(queryPort(sql), user.id, runtimeScope()).presentation(
      kind,
      id,
      action,
      version,
    )
  })
}
