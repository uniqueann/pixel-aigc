// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearInputDraft, clearLiveSession, readInputDraft, readLiveSession, writeInputDraft, writeLiveSession } from './liveSession'

const actor = { owner: '11111111-1111-4111-8111-111111111111', scope: 'preview' as const }
const requestId = '22222222-2222-4222-8222-222222222222'

beforeEach(() => localStorage.clear())

describe('工作站刷新会话', () => {
  it('按账号、环境和工具保存进行中的任务', () => {
    writeLiveSession({ v: 1, ...actor, tool: 'repaint', sourceKind: 'sync_credit', requestId, sourceId: requestId, createdAt: Date.now() })
    expect(readLiveSession(actor, 'repaint')?.requestId).toBe(requestId)
    expect(readLiveSession(actor, 'remove')).toBeUndefined()
    expect(readLiveSession({ ...actor, scope: 'production' }, 'repaint')).toBeUndefined()
    clearLiveSession(actor, 'repaint')
    expect(readLiveSession(actor, 'repaint')).toBeUndefined()
  })

  it('输入草稿拒绝 0 尺寸，并在刷新后读回真实宽高', () => {
    expect(writeInputDraft({ v: 1, ...actor, tool: 'repaint', name: '已有任务结果', objectKey: 'temporary/repaint-results/u/1.jpg', width: 0, height: 0, mimeType: 'image/jpeg', createdAt: Date.now() })).toBe(false)
    expect(readInputDraft(actor, 'repaint')).toBeUndefined()
    expect(writeInputDraft({ v: 1, ...actor, tool: 'repaint', name: '已有任务结果', objectKey: 'temporary/repaint-results/u/1.jpg', width: 640, height: 480, mimeType: 'image/jpeg', createdAt: Date.now() })).toBe(true)
    expect(readInputDraft(actor, 'repaint')).toMatchObject({ width: 640, height: 480, objectKey: 'temporary/repaint-results/u/1.jpg' })
    clearInputDraft(actor, 'repaint')
    expect(readInputDraft(actor, 'repaint')).toBeUndefined()
  })
})
