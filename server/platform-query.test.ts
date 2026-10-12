import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  platformQueryKeys,
  platformRewrites,
  withoutPlatformQuery,
} from './platform-query.js'

const vercel = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as { rewrites: { source: string; destination: string }[] }

describe('平台改写查询参数', () => {
  it('覆盖 vercel.json 里的全部改写规则', () => {
    expect(platformRewrites).toEqual(
      vercel.rewrites.map(({ source, destination }) => ({ source, destination })),
    )
  })

  it('剥离具名段和改写目标查询键，保留业务参数', () => {
    expect(platformQueryKeys()).toEqual(new Set(['__route', 'path']))
    const query = withoutPlatformQuery(
      new URLSearchParams(
        '__route=task-center&path=task-center&view=sidebar&tool=variation&state=all&limit=20&cursor=abc&scope=preview',
      ),
    )
    expect([...query.entries()]).toEqual([
      ['view', 'sidebar'],
      ['tool', 'variation'],
      ['state', 'all'],
      ['limit', '20'],
      ['cursor', 'abc'],
      ['scope', 'preview'],
    ])
  })

  it('重复具名段和后续新增规则也会被剥离', () => {
    const hidden = platformQueryKeys([
      { source: '/api/:path*', destination: '/api/entry?__route=:path*' },
      { source: '/v/:tenant/:id', destination: '/api/entry?trace=1' },
    ])
    expect([...hidden].sort()).toEqual(['__route', 'id', 'path', 'tenant', 'trace'])
    const query = withoutPlatformQuery(
      new URLSearchParams([
        ['__route', 'task-center/image_job/id'],
        ['path', 'task-center'],
        ['path', 'image_job'],
        ['tenant', 'acme'],
        ['trace', '1'],
        ['view', 'sidebar'],
      ]),
      hidden,
    )
    expect([...query.entries()]).toEqual([['view', 'sidebar']])
  })
})
