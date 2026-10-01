export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export function equalsAscii(bytes: Uint8Array, offset: number, value: string) {
  return [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0))
}

/** 文件头用于识别真实格式；完整有效性仍需由图片解码器校验。 */
export function detectImageMime(bytes: Uint8Array): ImageMime | undefined {
  if (bytes.length >= 8 && bytes[0] === 137 && equalsAscii(bytes, 1, 'PNG\r\n\x1a\n')) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 16 && equalsAscii(bytes, 0, 'RIFF') && equalsAscii(bytes, 8, 'WEBP')) return 'image/webp'
  return undefined
}

export function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsArrayBuffer(blob)
  })
}

/** 只读取文件头并纠正 MIME，不重编码、不缩放、不修改图片字节。 */
export async function normalizeImageBlob(blob: Blob): Promise<Blob> {
  const mimeType = detectImageMime(new Uint8Array(await readBlobBytes(blob.slice(0, 32))))
  if (!mimeType) throw new Error('仅支持 PNG、JPEG 和 WebP 图片，或图片文件已损坏')
  return blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType)
}
