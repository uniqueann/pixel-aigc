import { describe, expect, it } from 'vitest'
import { HttpError } from './errors'
import { goodsMatting, mattingFailure, mattingOperations, processedObjectKey, tencentCiConfig, type TencentCiConfig } from './tencent-ci'

const config: TencentCiConfig = {
  secretId: 'id', secretKey: 'key', bucket: 'example-1250000000', region: 'ap-guangzhou',
}

describe('腾讯云抠图配置', () => {
  it('四项都有才算已配置', () => {
    expect(tencentCiConfig({})).toBeNull()
    expect(tencentCiConfig({ TENCENT_COS_SECRET_ID: 'id', TENCENT_COS_SECRET_KEY: 'key', TENCENT_COS_BUCKET: 'bucket', TENCENT_COS_REGION: '' })).toBeNull()
    expect(tencentCiConfig({
      TENCENT_COS_SECRET_ID: 'id',
      TENCENT_COS_SECRET_KEY: 'key',
      TENCENT_COS_BUCKET: 'example-1250000000',
      TENCENT_COS_REGION: 'ap-guangzhou',
    })).toEqual(config)
  })

  it('结果文件使用存储桶绝对路径，并读取实际上传位置', async () => {
    const calls: Array<{ op: string; key?: string; fileid?: string }> = []
    const png = await goodsMatting(Buffer.from('jpeg'), config, {
      putObject(params, callback) {
        const operations = JSON.parse(String((params.Headers as { 'Pic-Operations': string })['Pic-Operations']))
        calls.push({ op: 'put', key: String(params.Key), fileid: operations.rules[0].fileid })
        callback(null, {
          UploadResult: { ProcessResults: { Object: { Key: `/${params.Key}.png` } } },
        })
      },
      getObject(params, callback) {
        calls.push({ op: 'get', key: String(params.Key) })
        callback(null, { Body: Buffer.from('png') })
      },
      deleteObject(params, callback) {
        calls.push({ op: 'delete', key: String(params.Key) })
        callback(null)
      },
    })
    expect(png.toString()).toBe('png')
    const put = calls.find(call => call.op === 'put')
    expect(put?.fileid).toBe(`/${put?.key}.png`)
    expect(mattingOperations(`${put?.key}.png`).rules[0].rule).toBe('ci-process=GoodsMatting&center-layout=0')
    expect(calls.find(call => call.op === 'get')?.key).toBe(`${put?.key}.png`)
    expect(calls.filter(call => call.op === 'delete').map(call => call.key)).toEqual([put?.key, `${put?.key}.png`])
  })

  it('上传回执里的真实路径优先于预定路径', () => {
    expect(processedObjectKey({
      UploadResult: { ProcessResults: { Object: [{ Key: '/bg-remove/bg-remove/a.png' }] } },
    }, 'bg-remove/a.png')).toBe('bg-remove/bg-remove/a.png')
    expect(mattingOperations('bg-remove/a.png').rules[0].fileid).toBe('/bg-remove/a.png')
  })

  it('把云端错误码转成可读说明', () => {
    expect(mattingFailure(new HttpError(503, '未配置', 'BG_REMOVE_UNCONFIGURED')).message).toBe('未配置')
    expect(mattingFailure({ code: 'ImageTooLarge' })).toMatchObject({ status: 400, message: '腾讯云商品抠图失败：图片尺寸不符合商品抠图要求' })
    expect(mattingFailure({ error: { Code: 'NoSuchKey' } }).message).toBe('腾讯云商品抠图失败：没有找到抠图结果')
    expect(mattingFailure({ code: 'InternalError' }).message).toBe('腾讯云商品抠图失败（InternalError）')
    expect(mattingFailure(new Error('network')).message).toBe('腾讯云商品抠图失败')
  })
})
