import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateEmail, stripEmailMarkdown } from './email-tasks'

const params = { sourceText: '客户想知道订单何时送达', operation: 'reply' as const, language: 'zh' as const }
const response = (content: string) => new Response(JSON.stringify({ id: 'generation-1',
  choices: [{ finish_reason: 'stop', message: { content } }],
  usage: { prompt_tokens: 42, completion_tokens: 23, total_tokens: 65 } }), { status: 200 })

beforeEach(() => {
  vi.stubEnv('EMAIL_ASSIST_ENABLED', 'true'); vi.stubEnv('DEEPSEEK_EMAIL_ENABLED', 'true'); vi.stubEnv('AI_GATEWAY_EMAIL_ENABLED', 'true')
  vi.stubEnv('CRON_SECRET', 'test-cron'); vi.stubEnv('DEEPSEEK_API_KEY', 'platform-deepseek'); vi.stubEnv('AI_GATEWAY_API_KEY', 'platform-gateway')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('邮件结果纯文本', () => {
  it('prompt 要求不输出 Markdown', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('正文')); vi.stubGlobal('fetch', fetchMock)
    await generateEmail('deepseek:deepseek-flash', params)
    const system = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content as string
    expect(system).toContain('纯文本')
    expect(system).toContain('Markdown')
  })

  it('清理成对的 Markdown 标记', () => {
    expect(stripEmailMarkdown('您好，**张总**：\n关于__交期__问题，`预计下周`发货。')).toBe('您好，张总：\n关于交期问题，预计下周发货。')
    expect(stripEmailMarkdown('## 摘要\n内容')).toBe('摘要\n内容')
    expect(stripEmailMarkdown('正文\n---\n落款')).toBe('正文\n\n落款')
  })

  it('不动正文里合法的单个符号', () => {
    expect(stripEmailMarkdown('2*3=6，*注：以合同为准*')).toBe('2*3=6，*注：以合同为准*')
    expect(stripEmailMarkdown('- 第一点\n- 第二点')).toBe('- 第一点\n- 第二点')
    expect(stripEmailMarkdown('价格 ** 100 ** 元')).toBe('价格  100  元')
  })

  it('不成对的标记保持原样，由调用方决定是否回退', () => {
    expect(stripEmailMarkdown('   ')).toBe('')
    expect(stripEmailMarkdown('**')).toBe('**')
  })
})
