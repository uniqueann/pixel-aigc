export interface PreviewLoadTokens { sequence: number; tokens: Map<string, number> }

/**
 * 预览原图加载编号：全局递增，请求结束后释放标记，避免浏览过的资产在内存中无限累积。
 * 编号不复用，迟到的响应仍能判定为过期。
 */
export function beginPreviewLoad(state: PreviewLoadTokens, identity: string) {
  const token = ++state.sequence
  state.tokens.set(identity, token)
  return token
}

/** 只释放自己那一轮的标记；已有更新请求时保留，避免旧响应盖住新画面。 */
export function settlePreviewLoad(state: PreviewLoadTokens, identity: string, token: number) {
  if (state.tokens.get(identity) === token) state.tokens.delete(identity)
}
