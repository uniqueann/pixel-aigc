/**
 * 与 vercel.json 的 rewrites 同步。
 * 测试会对照仓库文件，新增具名段时必须出现在这里，否则平台注入的查询键会再次被业务接口拒绝。
 */
export const platformRewrites: { source: string; destination: string }[] = [
  { source: '/api/:path*', destination: '/api/entry?__route=:path*' },
  { source: '/about', destination: '/about.html' },
  { source: '/privacy', destination: '/privacy.html' },
  { source: '/((?!api/).*)', destination: '/index.html' },
]

const NAMED_SEGMENT = /:([A-Za-z_][A-Za-z0-9_]*)/g

/** 改写规则可能写进查询串的键：源路径具名段，以及目标地址自带的查询键。 */
export function platformQueryKeys(
  rewrites: readonly { source: string; destination: string }[] = platformRewrites,
): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const rewrite of rewrites) {
    for (const match of rewrite.source.matchAll(NAMED_SEGMENT)) keys.add(match[1])
    const queryIndex = rewrite.destination.indexOf('?')
    if (queryIndex < 0) continue
    for (const key of new URLSearchParams(rewrite.destination.slice(queryIndex + 1)).keys())
      keys.add(key)
  }
  return keys
}

/** 去掉平台改写注入的查询参数，保留调用方自己传入的参数。 */
export function withoutPlatformQuery(
  query: URLSearchParams,
  hidden: ReadonlySet<string> = platformQueryKeys(),
): URLSearchParams {
  const next = new URLSearchParams()
  for (const [key, value] of query.entries()) {
    if (!hidden.has(key)) next.append(key, value)
  }
  return next
}
