import { describe, expect, it } from 'vitest'
import { beginPreviewLoad, settlePreviewLoad, type PreviewLoadTokens } from './previewLoadToken'

const fresh = (): PreviewLoadTokens => ({ sequence: 0, tokens: new Map() })

describe('预览原图加载标记', () => {
  it('请求结束后释放标记，浏览过的资产不会无限累积', () => {
    const state = fresh()
    const token = beginPreviewLoad(state, 'a')
    expect(state.tokens.size).toBe(1)

    settlePreviewLoad(state, 'a', token)
    expect(state.tokens.size).toBe(0)
  })

  it('编号全局递增且不复用，迟到的旧响应仍会被判定为过期', () => {
    const state = fresh()
    const first = beginPreviewLoad(state, 'a')
    const second = beginPreviewLoad(state, 'a')
    settlePreviewLoad(state, 'a', second)
    const third = beginPreviewLoad(state, 'a')

    // 旧请求 settle 不能删除新请求的标记；编号也不会回到 1，避免与仍在途的旧响应相同。
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
    settlePreviewLoad(state, 'a', first)
    expect(state.tokens.get('a')).toBe(third)
  })
})
