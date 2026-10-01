/** 同步图像工具的大结果描述；图片字节通过私有对象签名地址下载。 */
export interface SyncImageObjectResult {
  objectKey: string
  url: string
  mimeType: 'image/jpeg' | 'image/png'
  bytes?: number
  expiresAt?: number
}
