import { describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import { buildEmailAssistRequest } from './requestBuilder'

describe('buildEmailAssistRequest', () => {
  it('清理邮件文本并只为润色任务保留润色方式', () => {
    const request = buildEmailAssistRequest({
      sourceText: '  客户邮件  ',
      operation: 'reply',
      language: 'zh',
      instruction: '  委婉回复  ',
      polishStyles: ['shorten'],
    }, 'email-request')

    expect(request).toEqual({
      capability: Capability.EmailAssist,
      requestId: 'email-request',
      params: {
        sourceText: '客户邮件',
        operation: 'reply',
        language: 'zh',
        instruction: '委婉回复',
      },
    })
  })

  it('拒绝空邮件', () => {
    expect(() => buildEmailAssistRequest({ sourceText: ' ', operation: 'reply', language: 'zh' }))
      .toThrow('请先粘贴需要处理的邮件内容')
  })
})
