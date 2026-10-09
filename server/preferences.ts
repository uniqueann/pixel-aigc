import { applyPreferencesPatch, defaultPreferences, normalizePreferences, preferencesRequestSchema, type PreferencesResponse } from '../shared/preferences.js'
import type { authenticate } from './auth.js'
import { runtimeScope, withIdentity } from './db.js'
import { HttpError } from './errors.js'
import { requireActive } from './members.js'

type User = Awaited<ReturnType<typeof authenticate>>
function response(row?: { preferences: unknown; updated_at: Date | string }): PreferencesResponse {
  return {
    preferences: row ? normalizePreferences(row.preferences) : defaultPreferences(),
    hasStoredPreferences: Boolean(row), updatedAt: row ? new Date(row.updated_at).toISOString() : null,
  }
}

export async function handlePreferencesRoute(user: User, method: string, path: string[], body: unknown) {
  const route = path.join('/')
  if (!(route === 'preferences' && ['GET', 'PATCH'].includes(method)) && !(route === 'preferences/reset' && method === 'POST'))
    throw new HttpError(404, '接口不存在', 'NOT_FOUND')
  const input = method === 'PATCH' ? preferencesRequestSchema.parse(body) : undefined
  return withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    if (method === 'GET') {
      const [row] = await sql`select preferences,updated_at from aigc.user_preferences where user_id=${user.id} and scope=${runtimeScope()}`
      return response(row as { preferences: unknown; updated_at: Date } | undefined)
    }
    // 同一账号、同一环境串行合并字段，也涵盖首次创建记录时的竞争。
    await sql`select pg_advisory_xact_lock(hashtext(${`preferences:${user.id}:${runtimeScope()}`}))`
    const [row] = await sql`select preferences,updated_at from aigc.user_preferences where user_id=${user.id} and scope=${runtimeScope()} for update`
    if (input?.initializeOnly && row) return response(row as { preferences: unknown; updated_at: Date })
    let preferences = route === 'preferences/reset' ? defaultPreferences() : normalizePreferences(row?.preferences)
    for (const patch of input?.patches ?? []) preferences = applyPreferencesPatch(preferences, patch)
    const [saved] = await sql`insert into aigc.user_preferences(user_id,scope,schema_version,preferences)
      values(${user.id},${runtimeScope()},1,${sql.json(preferences)})
      on conflict(user_id,scope) do update set preferences=excluded.preferences,schema_version=1,updated_at=now()
      returning preferences,updated_at`
    return response(saved as { preferences: unknown; updated_at: Date })
  })
}
