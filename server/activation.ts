import { uploadEventSchema, welcomePatchSchema, type WelcomeState } from '../shared/activation.js'
import type { authenticate } from './auth.js'
import { runtimeScope, withIdentity, type Transaction } from './db.js'
import { HttpError } from './errors.js'
import { requireActive } from './members.js'

export async function readWelcomeState(sql: Transaction, userId: string): Promise<WelcomeState> {
  const [state] = await sql`select credit_notice_seen,starter_card_dismissed,analytics_enabled
    from aigc.user_welcome_state where user_id=${userId} and scope=${runtimeScope()}`
  const [credit] = await sql`select delta from aigc.credit_ledger
    where user_id=${userId} and scope=${runtimeScope()} and idempotency_key='initial'`
  const [work] = await sql`select exists(select 1 from aigc.credit_ledger
    where user_id=${userId} and scope=${runtimeScope()} and kind='settle'
      and (charged>0 or meta->>'free'='true')) as has_work`
  return {
    initialCredits: credit ? Number(credit.delta) : null,
    creditNoticeSeen: state?.credit_notice_seen === true,
    starterCardDismissed: state?.starter_card_dismissed === true,
    analyticsEnabled: state?.analytics_enabled !== false,
    hasCreatedWork: work?.has_work === true,
  }
}

export async function handleActivationRoute(user: Awaited<ReturnType<typeof authenticate>>, method: string, path: string[], body: unknown) {
  const route = path.join('/')
  if (!(route === 'activation' && ['GET', 'PATCH'].includes(method))
    && !(route === 'activation/events' && method === 'POST')) throw new HttpError(404, '接口不存在', 'NOT_FOUND')
  const patch = method === 'PATCH' ? welcomePatchSchema.parse(body) : undefined
  const event = route === 'activation/events' ? uploadEventSchema.parse(body) : undefined
  return withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    if (event) {
      const [row] = await sql`select aigc.record_first_upload(${event.tool}) as recorded`
      return { recorded: row.recorded === true }
    }
    if (patch) {
      await sql`insert into aigc.user_welcome_state(user_id,scope,credit_notice_seen,starter_card_dismissed,analytics_enabled)
        values(${user.id},${runtimeScope()},${patch.creditNoticeSeen ?? false},${patch.starterCardDismissed ?? false},${patch.analyticsEnabled ?? true})
        on conflict(user_id,scope) do update set
          credit_notice_seen=aigc.user_welcome_state.credit_notice_seen or excluded.credit_notice_seen,
          starter_card_dismissed=aigc.user_welcome_state.starter_card_dismissed or excluded.starter_card_dismissed,
          analytics_enabled=coalesce(${patch.analyticsEnabled ?? null}::boolean,aigc.user_welcome_state.analytics_enabled)`
    }
    return readWelcomeState(sql, user.id)
  })
}
