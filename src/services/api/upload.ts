/**
 * 蒙版上传占位实现。对象存储直传接口就绪后应在这里上传 dataURL，
 * 并返回可供 Provider 访问的对象存储 URL。
 */
export function uploadDataUrl(dataUrl: string): Promise<string> {
  return Promise.resolve(dataUrl)
}
