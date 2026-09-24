import { MAX_ZIP_BYTES } from './inspect'

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

export async function createResultZip(files: { name: string; blob: Blob }[]) {
  if (!files.length) throw new Error('没有可打包的处理结果')
  if (files.reduce((sum, file) => sum + file.blob.size, 0) > MAX_ZIP_BYTES) {
    throw new Error('结果超过 200 MB，请逐张下载')
  }
  const { BlobReader, BlobWriter, ZipWriter } = await import('@zip.js/zip.js')
  const writer = new ZipWriter(new BlobWriter('application/zip'), { level: 0 })
  for (const file of files) {
    await writer.add(file.name, new BlobReader(file.blob), { level: 0 })
  }
  return writer.close()
}
