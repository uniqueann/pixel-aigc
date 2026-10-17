import { detectImageMime } from '@shared/image-format'
import { scaleSuiteComposition, suiteRendererSupported } from '@shared/ecommerce-suite-annotations'
import { checkSuiteEncoded, suiteCheck, suiteChecksFailed, type SuiteCheckedVersion, type SuiteCheck, type SuiteEncodedMetadata, type SuitePrecheck } from '@shared/ecommerce-suite-precheck'
import { MAX_ZIP_BYTES } from '@/pages/Toolbox/shared/inspect'
import { createResultZip } from '@/pages/Toolbox/shared/zip'
import { suiteFilename } from './config'
import { encodeSuiteImage } from './render'

export interface SuiteExportedFile {
  slotId: string
  versionId: string
  name: string
  checks: SuiteCheck[]
  blob?: Blob
  metadata?: SuiteEncodedMetadata
  error?: string
}
export interface SuiteExportSkip { slotId: string; name: string; reason: string }
export async function inspectSuiteEncoded(blob: Blob): Promise<SuiteEncodedMetadata> {
  const mimeType = detectImageMime(new Uint8Array(await blob.slice(0, 32).arrayBuffer()))
  if (!mimeType) throw new Error('实际文件不是支持的图片格式')
  const bitmap = await createImageBitmap(blob)
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return { mimeType, width: bitmap.width, height: bitmap.height, bytes: blob.size,
      checksum: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
  } finally { bitmap.close() }
}
export function suiteExportName(report: SuitePrecheck, item: SuiteCheckedVersion) {
  return suiteFilename([...report.title].slice(0, 24).join(''), `${String(item.slot.order + 1).padStart(2, '0')}_${[...item.slot.name].slice(0, 24).join('')}`, item.version.versionNumber,
    report.output, `image/${report.output.format}`)
}
/** 一次仅解码一张，保留编码后的 Blob；失败仅重读或编码，不生成图片。 */
export async function encodeSuiteSelection(report: SuitePrecheck, read: (item: SuiteCheckedVersion) => Promise<Blob>, signal: AbortSignal,
  progress: (completed: number, total: number) => void = () => undefined, previous: SuiteExportedFile[] = []): Promise<SuiteExportedFile[]> {
  const files: SuiteExportedFile[] = []
  let bytes = 0
  for (const item of report.items) {
    signal.throwIfAborted()
    const old = previous.find(file => file.versionId === item.version.id && file.blob)
    if (old) { files.push(old); bytes += old.blob!.size; progress(files.length, report.items.length); continue }
    const file: SuiteExportedFile = { slotId: item.slot.id, versionId: item.version.id, name: suiteExportName(report, item), checks: [...item.checks] }
    try {
      if (suiteChecksFailed([...report.checks, ...item.checks])) throw new Error('存在确定性失败，请修复后重新预检')
      if (!suiteRendererSupported(item.version.composition)) throw new Error('当前客户端不支持该渲染器，请更新客户端')
      const composition = scaleSuiteComposition(item.version.composition, { width: report.output.width, height: report.output.height })
      const blob = await encodeSuiteImage(await read(item), composition, report.output.format, report.output.background, report.output.jpegQuality ?? .94, signal)
      signal.throwIfAborted()
      const metadata = await inspectSuiteEncoded(blob)
      file.checks.push(...checkSuiteEncoded(report.output, metadata))
      if (suiteChecksFailed(file.checks)) throw new Error('实际文件未通过检查，不能导出')
      if (bytes + blob.size > MAX_ZIP_BYTES) throw new Error('成品合计超过 200 MB，请缩小尺寸或减少所选槽位后拆分导出')
      bytes += blob.size; file.blob = blob; file.metadata = metadata
    } catch (error) {
      signal.throwIfAborted()
      file.error = error instanceof Error ? error.message : '文件编码失败'
      file.checks.push(suiteCheck('file.encode', 'fail', '文件读取与编码', file.error, '仅重试该文件的读取与合成，不触发生成', 'encoded_file'))
    }
    files.push(file); progress(files.length, report.items.length)
  }
  return files
}
export function suiteExportManifest(report: SuitePrecheck, files: SuiteExportedFile[], skipped: SuiteExportSkip[], acknowledged: boolean) {
  if (!acknowledged && [...report.checks, ...files.flatMap(file => file.checks)].some(check => ['unknown', 'warning'].includes(check.state)))
    throw new Error('请先核对并确认警告与未知项')
  return { format: 'pixel-suite-export', formatVersion: 1, exportedAt: new Date().toISOString(), projectId: report.projectId,
    platform: report.platform, ...(report.marketplace ? { marketplace: report.marketplace } : {}),
    output: report.output, ruleProfile: report.ruleProfile, ruleVersion: report.ruleVersion, ruleReviewedAt: report.ruleReviewedAt,
    checkedAt: report.checkedAt, precheckFingerprint: report.fingerprint, checks: report.checks,
    manualReviewAcknowledged: acknowledged, note: '检查结果供发布前核对，不代表平台审核通过；本包仅含成品与清单，不能恢复项目或执行任务。',
    files: files.filter(file => file.blob && !suiteChecksFailed(file.checks)).map(file => ({ slotId: file.slotId, versionId: file.versionId, name: file.name, metadata: file.metadata, checks: file.checks })),
    skipped: [...skipped, ...files.filter(file => !file.blob).map(file => ({ slotId: file.slotId, name: file.name, reason: file.error ?? '文件不可用' }))] }
}
export async function zipSuiteExport(report: SuitePrecheck, files: SuiteExportedFile[], skipped: SuiteExportSkip[], acknowledged: boolean, allowPartial: boolean) {
  const manifest = suiteExportManifest(report, files, skipped, acknowledged)
  if (manifest.skipped.length && !allowPartial) throw new Error('请明确确认仅导出成功项，或先修复缺失文件')
  const ready = files.filter(file => file.blob && !suiteChecksFailed(file.checks))
  if (!ready.length) throw new Error('没有通过检查的成品文件')
  return createResultZip([...ready.map(file => ({ name: file.name, blob: file.blob! })),
    { name: 'manifest.json', blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) }])
}
