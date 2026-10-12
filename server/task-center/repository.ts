import { z } from 'zod'
import type {
  TaskCenterSummary,
  TaskSourceKind,
  TaskScope,
  TaskTool,
} from '../../shared/task-center.js'
import { taskHistorySchema } from '../../shared/task-center.js'
import { HttpError } from '../errors.js'
import { TASK_PROJECTION } from './projection.js'

export interface TaskQuery {
  query(text: string, values?: unknown[]): Promise<Record<string, unknown>[]>
}
const tables: Record<TaskSourceKind, string> = {
  image_job: 'image_jobs',
  sync_credit: 'sync_credit_jobs',
  email_task: 'email_tasks',
}
const instant = (value: unknown) =>
  value == null ? null : new Date(value as string).toISOString()
const exactTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine((value) => {
    const date = new Date(value)
    return (
      Number(value.slice(0, 4)) > 0 &&
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 19) === value.slice(0, 19)
    )
  })
const cursorSchema = z
  .object({
    v: z.literal(1),
    owner: z.uuid(),
    scope: z.enum(['local', 'preview', 'production']),
    tool: z.string().nullable(),
    state: z.string(),
    snapshot: exactTimestamp,
    time: exactTimestamp,
    kind: z.enum(['image_job', 'sync_credit', 'email_task']),
    id: z.uuid(),
  })
  .strict()

export function taskSummary(row: Record<string, unknown>): TaskCenterSummary {
  const billing = row.billing_state as TaskCenterSummary['billingState']
  const charged =
    billing === 'none'
      ? 0
      : ['settled', 'refunded'].includes(billing)
        ? Number(row.ledger_charge)
        : null
  const state = row.state as TaskCenterSummary['state']
  const count = Number(row.completed_count),
    requested = Number(row.requested_count)
  return {
    sourceKind: row.source_kind as TaskSourceKind,
    sourceId: String(row.source_id),
    taskKey: `${row.source_kind}:${row.source_id}`,
    requestId: String(row.request_id),
    tool: row.tool as TaskTool | null,
    capability: String(row.capability),
    modelProfileId: row.model_profile_id as string | null,
    state,
    requestedCount: requested,
    completedCount: count,
    partial: state === 'succeeded' && count > 0 && count < requested,
    errorCode: state === 'succeeded' ? null : (row.error_code as string | null),
    warnings: row.warnings as string[],
    origin: row.origin as TaskCenterSummary['origin'],
    billingState: billing,
    creditsReserved: Number(row.credits_reserved),
    creditsCharged: charged,
    creditsReturned:
      charged === null
        ? null
        : Math.max(0, Number(row.credits_reserved) - charged),
    resultAvailability:
      row.result_expires_at &&
      new Date(row.result_expires_at as string).getTime() <= Date.now()
        ? 'expired'
        : count > 0
          ? 'available'
          : ['queued', 'processing'].includes(state)
            ? 'pending'
            : 'unavailable',
    resultExpiresAt: instant(row.result_expires_at),
    taskExpiresAt: instant(row.task_expires_at),
    createdAt: instant(row.created_at)!,
    updatedAt: instant(row.updated_at)!,
    completedAt: instant(row.completed_at),
    outcomeVersion: row.outcome_version as string | null,
    seen: !!row.seen,
    dismissed: !!row.dismissed,
  }
}

export function taskRepository(db: TaskQuery, owner: string, scope: TaskScope) {
  const base = [owner, scope]
  const retained = `(task_expires_at is null or task_expires_at>now())`
  const recent = `created_at>=now()-interval '30 days' and ${retained}`
  const get = async (kind: TaskSourceKind, id: string, byRequest = false) => {
    const rows = await db.query(
      `${TASK_PROJECTION} select * from presented where source_kind=$3 and ${byRequest ? 'request_id' : 'source_id'}=$4::uuid and ${retained}`,
      [...base, kind, id],
    )
    if (rows[0]) return rows[0]
    const idColumn = byRequest && kind !== 'sync_credit' ? 'request_id' : 'id'
    const native = await db.query(
      `select id${kind === 'sync_credit' ? '' : ',expires_at'} from aigc.${tables[kind]} where user_id=$1::uuid and scope=$2 and ${idColumn}=$3::uuid`,
      [...base, id],
    )
    if (native.length) throw new HttpError(410, '原任务已过期', 'TASK_EXPIRED')
    // 图片任务删除后没有原请求编号凭证，不能推断按请求查询的 404 意味着尚未执行。
    const proof =
      !byRequest || kind !== 'image_job'
        ? await db.query(
            `select 1 from aigc.credit_ledger where user_id=$1::uuid and scope=$2
      and ${byRequest && kind === 'email_task' ? 'idempotency_key=$3' : 'job_id=$3::uuid'} limit 1`,
            [
              ...base,
              byRequest && kind === 'email_task' ? `email:${id}:reserve` : id,
            ],
          )
        : []
    throw new HttpError(
      proof.length ? 410 : 404,
      proof.length ? '原任务已删除或过期' : '任务不存在或无权访问',
      proof.length ? 'TASK_EXPIRED' : 'TASK_NOT_FOUND',
    )
  }
  return {
    get,
    async items(kind: TaskSourceKind, id: string) {
      return kind === 'image_job'
        ? db.query(
            'select * from aigc.image_job_items where user_id=$1::uuid and scope=$2 and job_id=$3::uuid order by ordinal',
            [...base, id],
          )
        : []
    },
    async native(kind: TaskSourceKind, id: string, lock = false) {
      return (
        await db.query(
          `select * from aigc.${tables[kind]} where user_id=$1::uuid and scope=$2 and id=$3::uuid${lock ? ' for update' : ''}`,
          [...base, id],
        )
      )[0]
    },
    async sidebar() {
      const [data] = await db.query(
        `${TASK_PROJECTION}, recent as (select * from presented where ${recent}), chosen as (
        select * from recent where state in ('queued','processing') or (not seen and not dismissed)
        order by (state in ('queued','processing')) desc,created_at desc,source_kind desc,source_id desc limit 5
      ) select (select count(*)::int from recent where state in ('queued','processing')) as active,
        (select count(*)::int from recent where outcome_version is not null and not seen and not dismissed) as unseen,
        coalesce((select jsonb_agg(to_jsonb(chosen) order by (state in ('queued','processing')) desc,created_at desc,source_kind desc,source_id desc) from chosen),'[]'::jsonb) as items,
        to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as snapshot`,
        base,
      )
      return {
        items: (data.items as Record<string, unknown>[]).map(taskSummary),
        activeCount: Number(data.active),
        unseenCount: Number(data.unseen),
        snapshotAt: String(data.snapshot),
      }
    },
    async history(input: unknown) {
      const filters = taskHistorySchema.parse(input)
      let cursor: z.infer<typeof cursorSchema> | undefined
      if (filters.cursor) {
        try {
          cursor = cursorSchema.parse(
            JSON.parse(Buffer.from(filters.cursor, 'base64url').toString()),
          )
        } catch {
          throw new HttpError(400, '分页标识无效', 'INVALID_CURSOR')
        }
        if (
          cursor.owner !== owner ||
          cursor.scope !== scope ||
          cursor.tool !== (filters.tool ?? null) ||
          cursor.state !== filters.state ||
          cursor.time > cursor.snapshot ||
          new Date(cursor.snapshot).getTime() > Date.now() + 1000
        )
          throw new HttpError(400, '分页标识与当前筛选不匹配', 'INVALID_CURSOR')
      }
      const snapshot =
        cursor?.snapshot ??
        String(
          (
            await db.query(
              `select to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t`,
            )
          )[0].t,
        )
      const states: Record<string, string> = {
        all: 'true',
        active: "state in ('queued','processing')",
        succeeded: "state='succeeded'",
        failed: "state in ('failed','expired')",
      }
      const rows = await db.query(
        `${TASK_PROJECTION} select * from presented where created_at>=($3::timestamptz-interval '30 days') and ${retained} and created_at<=$3::timestamptz
        and ($4::text is null or tool=$4) and ${states[filters.state]}
        ${cursor ? 'and (created_at,source_kind,source_id)<($5::timestamptz,$6::text,$7::uuid)' : ''}
        order by created_at desc,source_kind desc,source_id desc limit ${filters.limit + 1}`,
        [
          ...base,
          snapshot,
          filters.tool ?? null,
          ...(cursor ? [cursor.time, cursor.kind, cursor.id] : []),
        ],
      )
      const page = rows.slice(0, filters.limit),
        last = page.at(-1)
      const nextCursor =
        rows.length > filters.limit && last
          ? Buffer.from(
              JSON.stringify({
                v: 1,
                owner,
                scope,
                tool: filters.tool ?? null,
                state: filters.state,
                snapshot,
                time: last.cursor_created_at,
                kind: last.source_kind,
                id: last.source_id,
              }),
            ).toString('base64url')
          : null
      return { items: page.map(taskSummary), nextCursor, snapshotAt: snapshot }
    },
    async presentation(
      kind: TaskSourceKind,
      id: string,
      action: 'seen' | 'dismiss',
      version: string,
    ) {
      if (!(await this.native(kind, id, true))) await get(kind, id)
      const row = await get(kind, id)
      if (!row.outcome_version || row.outcome_version !== version)
        throw new HttpError(
          409,
          '任务结果已变化，请重新查看',
          'TASK_PRESENTATION_CONFLICT',
        )
      const column = action === 'seen' ? 'seen' : 'dismissed'
      await db.query(
        `insert into aigc.task_ui_state(user_id,scope,source_kind,source_id,${column}_version,${column}_at)
        values($1::uuid,$2,$3,$4::uuid,$5,now()) on conflict(user_id,scope,source_kind,source_id)
        do update set ${column}_version=excluded.${column}_version,${column}_at=excluded.${column}_at,updated_at=now()`,
        [...base, kind, id, version],
      )
      return taskSummary(await get(kind, id))
    },
  }
}
