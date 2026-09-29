export const CREDITS_USAGE = [
  '用法：',
  '  发放：AIGC_ADMIN_OPERATOR=姓名 npm run aigc:credits -- 用户UUID 环境 正整数积分 幂等键 发放原因',
  '  设余额：AIGC_ADMIN_OPERATOR=姓名 npm run aigc:credits -- --set 0 用户UUID 环境 幂等键 调整原因',
  '  增减：AIGC_ADMIN_OPERATOR=姓名 npm run aigc:credits -- --amount -20 用户UUID 环境 幂等键 调整原因',
  '环境为 local / preview / production。--set 与 --amount 写入 adjust 流水，余额不会低于 0。',
].join('\n')

export function parseCreditsCommand(argv: string[]) {
  if (argv.includes('--help') || argv.includes('-h')) throw new Error(CREDITS_USAGE)
  let mode: 'grant' | 'set' | 'delta' = 'grant'
  let flagged: number | undefined
  const rest: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--set' || token === '--amount') {
      const raw = argv[index + 1]
      const parsed = Number(raw)
      if (!Number.isSafeInteger(parsed)) throw new Error(CREDITS_USAGE)
      mode = token === '--set' ? 'set' : 'delta'
      flagged = parsed
      index += 1
      continue
    }
    rest.push(token)
  }
  const [userId, scope, amountOrKey, keyOrReason, ...reasonParts] = rest
  if (mode === 'grant') {
    const amount = Number(amountOrKey)
    const key = keyOrReason
    const reason = reasonParts.join(' ').trim()
    if (!userId || !['local', 'preview', 'production'].includes(scope ?? '') || !Number.isSafeInteger(amount)
      || amount <= 0 || amount > 1_000_000 || !key || key.length > 128 || !reason)
      throw new Error(CREDITS_USAGE)
    return { mode, userId, scope, value: amount, key, reason }
  }
  const key = amountOrKey
  const reason = [keyOrReason, ...reasonParts].filter(Boolean).join(' ').trim()
  if (flagged === undefined || !userId || !['local', 'preview', 'production'].includes(scope ?? '')
    || !key || key.length > 128 || !reason)
    throw new Error(CREDITS_USAGE)
  if (mode === 'set' && (flagged < 0 || flagged > 1_000_000)) throw new Error(CREDITS_USAGE)
  if (mode === 'delta' && (flagged === 0 || Math.abs(flagged) > 1_000_000)) throw new Error(CREDITS_USAGE)
  return { mode, userId, scope, value: flagged, key, reason }
}
