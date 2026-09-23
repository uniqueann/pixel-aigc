import { outputNames } from './geometry'
import type { BatchImage } from './types'
import { MAX_ZIP_BYTES } from './validation'

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function namesForImages(images: BatchImage[]) {
  const names = outputNames(images.map(image => ({ name: image.file.name, mimeType: image.outputMime ?? image.sourceMime })))
  return new Map(images.map((image, index) => [image.id, names[index]]))
}

export async function createWatermarkZip(images: BatchImage[]) {
  const complete = images.filter(image => image.status === 'succeeded' && image.output)
  if (!complete.length) throw new Error('没有可打包的处理结果')
  if (complete.reduce((sum, image) => sum + image.output!.size, 0) > MAX_ZIP_BYTES) {
    throw new Error('结果超过 200 MB，请逐张下载')
  }
  const { BlobReader, BlobWriter, ZipWriter } = await import('@zip.js/zip.js')
  const writer = new ZipWriter(new BlobWriter('application/zip'), { level: 0 })
  const names = namesForImages(complete)
  for (const image of complete) {
    await writer.add(names.get(image.id)!, new BlobReader(image.output!), { level: 0 })
  }
  return writer.close()
}
