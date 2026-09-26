import { describe, expect, it } from 'vitest'
import { tencentCiConfig } from './tencent-ci'

describe('腾讯云抠图配置', () => {
  it('四项都有才算已配置', () => {
    expect(tencentCiConfig({})).toBeNull()
    expect(tencentCiConfig({ TENCENT_COS_SECRET_ID: 'id', TENCENT_COS_SECRET_KEY: 'key', TENCENT_COS_BUCKET: 'bucket', TENCENT_COS_REGION: '' })).toBeNull()
    expect(tencentCiConfig({
      TENCENT_COS_SECRET_ID: 'id',
      TENCENT_COS_SECRET_KEY: 'key',
      TENCENT_COS_BUCKET: 'example-1250000000',
      TENCENT_COS_REGION: 'ap-guangzhou',
    })).toEqual({
      secretId: 'id', secretKey: 'key', bucket: 'example-1250000000', region: 'ap-guangzhou',
    })
  })
})
