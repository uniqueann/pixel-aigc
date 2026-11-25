import { i18n } from '@/i18n'
import { formatMegabytes } from '@/i18n/format'
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
  if (!files.length) throw new Error(i18n.t('toolbox:validation.zipEmpty'))
  if (files.reduce((sum, file) => sum + file.blob.size, 0) > MAX_ZIP_BYTES) {
    throw new Error(i18n.t('toolbox:validation.zipTooLarge', { limit: formatMegabytes(MAX_ZIP_BYTES) }))
  }
  const { BlobReader, BlobWriter, ZipWriter } = await import('@zip.js/zip.js')
  const writer = new ZipWriter(new BlobWriter('application/zip'), { level: 0 })
  for (const file of files) {
    await writer.add(file.name, new BlobReader(file.blob), { level: 0 })
  }
  return writer.close()
}
