import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import type { Transaction } from '../db.js'

const mocks = vi.hoisted(() => ({ withIdentity: vi.fn() }))
vi.mock('../db.js', () => ({ runtimeScope: () => 'local', withIdentity: mocks.withIdentity }))
import { listImageTasks } from './service.js'

const user = { id: 'owner', email: 'owner@example.com', suggestedName: 'A', avatarUrl: null, providers: ['email'] }
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema aigc;
    create table aigc.members(user_id text primary key,status text);
    insert into aigc.members values('owner','active');
    create table aigc.image_jobs(id text primary key,user_id text,scope text,status text,
      model_profile_id text,capability text,params jsonb,created_at timestamptz,updated_at timestamptz,expires_at timestamptz);
  `)
  for (let index = 0; index < 22; index++) await db.query(`insert into aigc.image_jobs values($1,'owner','local','succeeded','dragoncode:gpt-image-2','text_to_image',
    '{"prompt":"香水瓶"}',now()-$2*interval '1 minute',now(),now()+interval '1 day')`, [`text-${index}`, index])
  for (const [id, owner, scope, capability, expires] of [
    ['variation', 'owner', 'local', 'variation', 1],
    ['other-owner', 'other', 'local', 'text_to_image', 1],
    ['other-scope', 'owner', 'preview', 'text_to_image', 1],
    ['expired', 'owner', 'local', 'text_to_image', -1],
  ]) await db.query(`insert into aigc.image_jobs values($1,$2,$3,'succeeded','dragoncode:gpt-image-2',$4,
    '{"prompt":"描述"}',now(),now(),now()+$5*interval '1 day')`, [id, owner, scope, capability, expires])
  const sql = ((parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '')
    return db.query(query, values as never[]).then(result => result.rows)
  }) as unknown as Transaction
  mocks.withIdentity.mockImplementation((_owner, _email, action) => action(sql))
}, 30000)
afterAll(async () => { await db.close() })

describe('图片任务历史查询', () => {
  it('计数和分页均按文生图过滤，并排除其他账号、环境及过期任务', async () => {
    const first = await listImageTasks(user, 1, 'text_to_image')
    expect(first.total).toBe(22)
    expect(first.items).toHaveLength(20)
    expect(first.items.every(item => item.capability === 'text_to_image')).toBe(true)
    expect(first.items.map(item => item.id)).toEqual(Array.from({ length: 20 }, (_, index) => `text-${index}`))
    const second = await listImageTasks(user, 2, 'text_to_image')
    expect(second.total).toBe(22)
    expect(second.items.map(item => item.id)).toEqual(['text-20', 'text-21'])
  })
  it('未传能力时保持全集列表兼容，传裂变只返回裂变', async () => {
    const all = await listImageTasks(user, 1)
    expect(all.total).toBe(23)
    expect(all.items.some(item => item.id === 'variation')).toBe(true)
    const variation = await listImageTasks(user, 1, 'variation')
    expect(variation.total).toBe(1)
    expect(variation.items.map(item => item.id)).toEqual(['variation'])
  })
})
