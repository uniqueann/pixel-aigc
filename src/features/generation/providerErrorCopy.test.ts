import { describe, expect, it } from 'vitest'
import { taskFailureText } from './providerErrorCopy'

describe('图片供应商错误文案', () => {
  it('上游权限限制使用固定提示，不沿用审核文案', () => {
    expect(taskFailureText('PROVIDER_FORBIDDEN', '内容未通过审核', '任务没有完成，请重试'))
      .toBe('图片服务暂不可用（上游权限限制）')
    expect(taskFailureText('PROVIDER_FORBIDDEN', undefined, '请重试或更换参数'))
      .toBe('图片服务暂不可用（上游权限限制）')
  })

  it('其他错误仍显示服务端文案', () => {
    expect(taskFailureText('CONTENT_REJECTED', '内容未通过审核', '任务没有完成，请重试')).toBe('内容未通过审核')
    expect(taskFailureText(undefined, '  ', '任务没有完成，请重试')).toBe('任务没有完成，请重试')
  })
})
