import { describe, expect, it } from 'vitest'
import { HttpError } from './errors'
import { chooseSubjectBox, detectGoodsSubject, goodsMatting, mattingFailure, mattingOperations, processedObjectKey, subjectFailure, tencentCiConfig, type TencentCiConfig } from './tencent-ci'

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

  it('多个主体取面积最大的框，面积相同则取更靠近中心的', () => {
    const payload = {
      RecognitionResult: {
        Status: '1',
        DetectMultiObj: [
          { Location: { X: '0', Y: '0', Width: '200', Height: '200' } },
          { Location: { X: '100', Y: '100', Width: '400', Height: '400' } },
        ],
      },
    }
    expect(chooseSubjectBox(payload, 1000, 1000)).toEqual({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 })
    expect(chooseSubjectBox({
      RecognitionResult: {
        Status: 1,
        DetectMultiObj: {
          Location: { X: 800, Y: 0, Width: 200, Height: 200 },
        },
      },
    }, 1000, 1000)).toEqual({ x: 0.8, y: 0, width: 0.2, height: 0.2 })
    expect(chooseSubjectBox({
      RecognitionResult: {
        Status: 1,
        DetectMultiObj: [
          { Location: { X: 0, Y: 400, Width: 200, Height: 200 } },
          { Location: { X: 400, Y: 400, Width: 200, Height: 200 } },
        ],
      },
    }, 1000, 1000)).toEqual({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 })
  })

  it('没识别到主体或坐标无效时返回空', () => {
    expect(chooseSubjectBox({ RecognitionResult: { Status: 0 } }, 1000, 1000)).toBeNull()
    expect(chooseSubjectBox({ RecognitionResult: { Status: 1, DetectMultiObj: { Location: { X: 0, Y: 0, Width: 0, Height: 10 } } } }, 100, 100)).toBeNull()
    expect(chooseSubjectBox(null, 100, 100)).toBeNull()
  })

  it('上传原图后请求主体检测，并删除临时对象', async () => {
    const calls: string[] = []
    const box = await detectGoodsSubject(Buffer.from('jpeg'), 1000, 500, config, {
      putObject(params, callback) {
        calls.push(`put:${params.Key}`)
        callback(null, {})
      },
      getObject(_params, callback) { callback(null, { Body: Buffer.from('') }) },
      deleteObject(params, callback) {
        calls.push(`delete:${params.Key}`)
        callback(null)
      },
      request(params, callback) {
        calls.push(`detect:${(params.Query as { 'ci-process': string })['ci-process']}`)
        callback(null, { RecognitionResult: { Status: 1, DetectMultiObj: { Location: { X: 100, Y: 50, Width: 200, Height: 100 } } } })
      },
    })
    expect(box).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
    expect(calls[0]).toMatch(/^put:subject-detect\//)
    expect(calls[1]).toBe('detect:AIObjectDetect')
    expect(calls[2]).toBe(calls[0].replace('put:', 'delete:'))
  })

  it('检测失败时仍删除临时对象', async () => {
    const deleted: string[] = []
    await expect(detectGoodsSubject(Buffer.from('jpeg'), 100, 100, config, {
      putObject(_params, callback) { callback(null, {}) },
      getObject(_params, callback) { callback(null, {}) },
      deleteObject(params, callback) { deleted.push(String(params.Key)); callback(null) },
      request(_params, callback) { callback(Object.assign(new Error('denied'), { code: 'AccessDenied' })) },
    })).rejects.toMatchObject({ status: 502, message: '腾讯云主体检测失败：存储桶拒绝了主体检测请求' })
    expect(deleted).toHaveLength(1)
    expect(subjectFailure(new HttpError(503, '未配置', 'SUBJECT_DETECT_UNCONFIGURED')).message).toBe('未配置')
  })

  it('把云端错误码转成可读说明', () => {
    expect(mattingFailure(new HttpError(503, '未配置', 'BG_REMOVE_UNCONFIGURED')).message).toBe('未配置')
    expect(mattingFailure({ code: 'ImageTooLarge' })).toMatchObject({ status: 400, message: '腾讯云商品抠图失败：图片尺寸不符合商品抠图要求' })
    expect(mattingFailure({ error: { Code: 'NoSuchKey' } }).message).toBe('腾讯云商品抠图失败：没有找到抠图结果')
    expect(mattingFailure({ code: 'InternalError' }).message).toBe('腾讯云商品抠图失败（InternalError）')
    expect(mattingFailure(new Error('network')).message).toBe('腾讯云商品抠图失败')
  })
})
