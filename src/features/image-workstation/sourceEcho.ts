import { blobFromImageSource } from './download'

const SAMPLE_SIZE = 64
const MEAN_DIFF_LIMIT = 4

function buffersEqual(left: ArrayBuffer, right: ArrayBuffer) {
  if (left.byteLength !== right.byteLength) return false
  const a = new Uint8Array(left)
  const b = new Uint8Array(right)
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}

function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsArrayBuffer(blob)
  })
}

async function decodeSample(blob: Blob): Promise<Uint8ClampedArray | undefined> {
  if (typeof createImageBitmap !== 'function' && typeof Image === 'undefined') return undefined
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = SAMPLE_SIZE
      canvas.height = SAMPLE_SIZE
      const context = canvas.getContext('2d')
      if (!context) {
        bitmap.close()
        return undefined
      }
      context.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      bitmap.close()
      return context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
    }
  } catch {
    return undefined
  }
  return undefined
}

function meanAbsoluteDiff(left: Uint8ClampedArray, right: Uint8ClampedArray) {
  const length = Math.min(left.length, right.length)
  if (length === 0) return Number.POSITIVE_INFINITY
  let total = 0
  for (let index = 0; index < length; index += 1) total += Math.abs(left[index] - right[index])
  return total / length
}

/** 字节完全相同，或缩小后像素几乎一样，视为原图回传。 */
export async function isVisuallySameImage(source: Blob | string, result: Blob | string) {
  if (typeof source === 'string' && typeof result === 'string' && source === result) return true
  let sourceBlob: Blob
  let resultBlob: Blob
  try {
    ;[sourceBlob, resultBlob] = await Promise.all([blobFromImageSource(source), blobFromImageSource(result)])
  } catch {
    return false
  }
  if (sourceBlob.size === resultBlob.size) {
    try {
      if (buffersEqual(await readBlobBytes(sourceBlob), await readBlobBytes(resultBlob))) return true
    } catch {
      /* 继续走像素比较 */
    }
  }
  const [sourceSample, resultSample] = await Promise.all([decodeSample(sourceBlob), decodeSample(resultBlob)])
  if (!sourceSample || !resultSample) return false
  return meanAbsoluteDiff(sourceSample, resultSample) <= MEAN_DIFF_LIMIT
}

export const SOURCE_ECHO_ERROR = '任务已完成，但没有返回新的生成结果'
