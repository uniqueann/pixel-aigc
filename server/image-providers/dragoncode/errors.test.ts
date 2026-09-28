import { describe, expect, it } from 'vitest'
import {
  USER_AUTH_FAILURE,
  USER_CONTENT_REJECTED,
  USER_GENERIC_FAILURE,
  USER_NOT_FOUND,
  classifyFailedTask,
  dragonCodeFailure,
  mapDragonCodeHttpError,
  readResultUrls,
  readSubmitTaskId,
  readVendorUsage,
  redactSensitive,
  sanitizePayload,
  sanitizeUserFacingMessage,
} from './errors.js'
import {
  FAKE_MEDIA_TOKEN,
  FAKE_MEDIA_URL,
  FAKE_TASK_ID,
  authInvalidApiKey,
  pollCompleted1k,
  pollFailedUpstream,
  submitSuccess,
  taskNotFound,
  validationNNotOne,
} from './fixtures.js'

describe('DragonCode 响应解析', () => {
  it('提交成功 data 是数组，取 data[0].task_id', () => {
    expect(readSubmitTaskId(submitSuccess)).toBe(FAKE_TASK_ID)
    expect(readSubmitTaskId({ code: 200, data: { task_id: 'legacy' } })).toBeUndefined()
  })

  it('完成结果只走 result.images[].url[]', () => {
    expect(readResultUrls(pollCompleted1k.data)).toEqual([FAKE_MEDIA_URL])
    expect(readResultUrls({ result: { images: [{ url: 'https://example/not-array.png' }] } })).toEqual([])
    expect(readVendorUsage(pollCompleted1k.data)).toEqual({
      cost: 0.0085, creditsCost: 1, expiresAt: 1_759_116_436,
    })
  })

  it('四种错误形状都能分类', () => {
    expect(mapDragonCodeHttpError(401, authInvalidApiKey)).toMatchObject({
      code: 'INVALID_KEY', message: USER_AUTH_FAILURE, retryable: false, status: 401,
    })
    expect(mapDragonCodeHttpError(400, validationNNotOne)).toMatchObject({
      code: 'INVALID_PARAMS', message: '当前模型每次只能生成 1 张', retryable: false,
    })
    expect(mapDragonCodeHttpError(404, taskNotFound)).toMatchObject({
      code: 'BAD_RESPONSE', message: USER_NOT_FOUND, retryable: false,
    })
    expect(dragonCodeFailure(pollFailedUpstream.data.error.message, pollFailedUpstream, { taskFailed: true })).toMatchObject({
      code: 'CONTENT_REJECTED', message: USER_CONTENT_REJECTED,
    })
  })

  it('清洗上游原文，日志可保留原文但用户侧不出现', () => {
    const raw = pollFailedUpstream.data.error.message
    expect(sanitizeUserFacingMessage(raw)).toBe(USER_GENERIC_FAILURE)
    expect(classifyFailedTask(raw).message).toBe(USER_CONTENT_REJECTED)
    expect(redactSensitive(FAKE_MEDIA_URL)).toBe(`dragoncode.codes/gpt-image/media/${FAKE_TASK_ID}/0`)
    expect(JSON.stringify(sanitizePayload(pollCompleted1k))).not.toContain(FAKE_MEDIA_TOKEN)
  })
})
