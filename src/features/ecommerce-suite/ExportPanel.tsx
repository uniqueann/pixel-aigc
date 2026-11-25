import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Collapse, Image, InputNumber, Modal, Progress, Select, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatDateTime } from '@/i18n/format'
import type { SuiteActor } from '@shared/ecommerce-suite'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import { suiteChecksFailed, type SuiteExportConfig, type SuitePrecheck } from '@shared/ecommerce-suite-precheck'
import { suiteExportConfigSchema } from '@shared/ecommerce-suite'
import { downloadBlob } from '@/pages/Toolbox/shared/zip'
import type { SuiteClient } from './api'
import { formatSuiteError, localizeSuiteCheck, suiteSlotLabel } from './i18n'
import { backupAssetBlob } from './recoveryPackage'
import { encodeSuiteSelection, zipSuiteExport, type SuiteExportedFile, type SuiteExportSkip } from './export'

function ExportPreview({ file }: { file: SuiteExportedFile }) {
  const { t } = useTranslation('ecommerce')
  const [urls, setUrls] = useState<{ thumbnail: string; original: string }>()
  useEffect(() => {
    if (!file.blob) return
    let disposed = false, thumbnail: string | undefined
    const original = URL.createObjectURL(file.blob)
    void (async () => {
      const image = await createImageBitmap(file.blob!, { resizeWidth: 240, resizeHeight: Math.max(1, Math.round(240 * (file.metadata?.height ?? 1) / (file.metadata?.width ?? 1))) })
      const canvas = document.createElement('canvas')
      try {
        canvas.width = image.width; canvas.height = image.height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error(t('export.errors.thumbUnavailable'))
        ctx.drawImage(image, 0, 0)
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
        if (!disposed && blob) { thumbnail = URL.createObjectURL(blob); setUrls({ thumbnail, original }) }
      } finally { image.close(); canvas.width = 1; canvas.height = 1 }
    })().catch(() => { if (!disposed) setUrls(undefined) })
    return () => { disposed = true; URL.revokeObjectURL(original); if (thumbnail) URL.revokeObjectURL(thumbnail) }
  }, [file.blob, file.metadata?.height, file.metadata?.width, t])
  return urls ? <figure><Image src={urls.thumbnail} preview={{ src: urls.original }} alt={t('export.previewAlt', { name: file.name })} width={150} /><figcaption>{t('export.previewCaption', { width: file.metadata?.width, height: file.metadata?.height })}</figcaption></figure> : null
}
export default function ExportPanel({ actor, data, client, signal, liveKey, initialSlotId, prepare, onClose }: {
  actor: SuiteActor; data: SuiteProjectDetail; client: SuiteClient; signal: AbortSignal; liveKey: string; initialSlotId?: string
  prepare: (slotIds: string[]) => Promise<SuiteProjectDetail>; onClose: () => void
}) {
  const { t } = useTranslation(['ecommerce', 'common'])
  const [selected, setSelected] = useState(() => initialSlotId ? [initialSlotId] : data.project.config.slots.filter(slot => slot.enabled).map(slot => slot.id))
  const [output, setOutput] = useState<SuiteExportConfig>({ platform: data.project.config.platform, width: 2000, height: 2000, format: 'jpeg', background: '#ffffff', jpegQuality: .94 })
  const [report, setReport] = useState<SuitePrecheck>()
  const [files, setFiles] = useState<SuiteExportedFile[]>([])
  const [skipped, setSkipped] = useState<SuiteExportSkip[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [partial, setPartial] = useState(false)
  const currentKey = useRef(liveKey)
  const [verifiedKey, setVerifiedKey] = useState<string>()
  const controller = useRef<AbortController>()
  useLayoutEffect(() => { currentKey.current = liveKey }, [liveKey])
  const invalidate = () => { controller.current?.abort(); setReport(undefined); setFiles([]); setAcknowledged(false); setPartial(false) }
  useEffect(() => {
    if (report && verifiedKey !== liveKey) controller.current?.abort()
  }, [liveKey, report, verifiedKey])
  useEffect(() => () => { controller.current?.abort() }, [])
  const patch = (value: Partial<SuiteExportConfig>) => { invalidate(); setOutput(old => ({ ...old, ...value })) }
  const check = async (retry = false) => {
    const run = new AbortController(); controller.current?.abort(); controller.current = run
    const combined = AbortSignal.any([signal, run.signal])
    setBusy(true); setError(''); setProgress(0); setAcknowledged(false); setPartial(false)
    try {
      const parsed = suiteExportConfigSchema.parse(output)
      let frozen = retry && verifiedKey === currentKey.current ? report : undefined
      if (!frozen) {
        setReport(undefined); setFiles([])
        const saved = await prepare(selected)
        combined.throwIfAborted(); client.assertCurrent()
        const versions: string[] = [], missing: SuiteExportSkip[] = []
        for (const id of selected) {
          const slot = saved.project.config.slots.find(slot => slot.id === id)!
          const versionId = saved.project.slotHeads.find(head => head.slotId === id)?.activeVersionId
          if (versionId) versions.push(versionId)
          else missing.push({ slotId: id, name: suiteSlotLabel(slot), reason: t('ecommerce:export.skippedNoVersion') })
        }
        setSkipped(missing)
        if (!versions.length) throw new Error(t('ecommerce:export.errors.noSavedVersions'))
        frozen = await client.precheck(saved.project.id, versions, parsed)
        combined.throwIfAborted()
        // 保存引发的修订先呈现，再建立本次检查的失效基准。
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        setVerifiedKey(currentKey.current)
      }
      const expectedKey = currentKey.current
      const encoded = await encodeSuiteSelection(frozen, async item => {
        client.assertCurrent()
        return backupAssetBlob(actor, item.asset, combined)
      }, combined, (done, total) => setProgress(Math.round(done / total * 100)), retry ? files : [])
      combined.throwIfAborted(); client.assertCurrent()
      if (expectedKey !== currentKey.current) throw new Error(t('ecommerce:export.errors.changedDuringEncode'))
      // 警告、未知项与部分导出都必须由用户显式确认；预检完成不能自动放行下载。
      setReport(frozen); setFiles(encoded)
    } catch (error) { if (!signal.aborted) setError(run.signal.aborted ? t('ecommerce:export.errors.cancelled') : formatSuiteError(error, 'ecommerce:export.errors.precheckFailed')) }
    finally { if (!signal.aborted && controller.current === run) setBusy(false) }
  }
  const stale = Boolean(report && verifiedKey !== liveKey)
  const ready = stale ? [] : files.filter(file => file.blob && !suiteChecksFailed(file.checks))
  const failures = skipped.length + files.filter(file => !file.blob).length
  const needsReview = Boolean(report && [...report.checks, ...files.flatMap(file => file.checks)].some(check => ['warning', 'unknown'].includes(check.state)))
  const canDownload = !busy && report && ready.length > 0 && (!needsReview || acknowledged) && (!failures || partial) && verifiedKey === liveKey
  const download = async (single = false) => {
    if (!canDownload || !report) return
    const run = new AbortController(); controller.current = run
    setBusy(true); setError('')
    try {
      client.assertCurrent()
      const latest = await client.precheck(report.projectId, report.items.map(item => item.version.id), report.output)
      if (latest.fingerprint !== report.fingerprint) { setReport(undefined); setFiles([]); throw new Error(t('ecommerce:export.errors.cloudChanged')) }
      run.signal.throwIfAborted()
      if (single && ready.length === 1) downloadBlob(ready[0].blob!, ready[0].name)
      else {
        const zip = await zipSuiteExport(report, files, skipped, acknowledged, partial)
        run.signal.throwIfAborted()
        client.assertCurrent()
        if (verifiedKey !== currentKey.current) throw new Error(t('ecommerce:export.errors.projectChanged'))
        downloadBlob(zip, ready[0].name.replace(/\.[^.]+$/, '') + t('ecommerce:export.zipSuffix'))
      }
    } catch (error) { if (!signal.aborted) setError(formatSuiteError(error, 'ecommerce:export.errors.zipFailed')) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const totalSize = t('common:units.mb', { value: (ready.reduce((sum, file) => sum + file.blob!.size, 0) / 1024 / 1024).toFixed(2) })
  return <Modal open title={t('ecommerce:export.title')} width={960} onCancel={() => { controller.current?.abort(); onClose() }} footer={<div className="suite-actions">
    {busy && <Button onClick={() => controller.current?.abort()}>{t('ecommerce:export.cancelButton')}</Button>}
    <Button disabled={busy || !selected.length} onClick={() => { void check() }}>{t('ecommerce:export.checkButton')}</Button>
    {report && !stale && files.some(file => file.error) && <Button disabled={busy} onClick={() => { void check(true) }}>{t('ecommerce:export.retryFailedButton')}</Button>}
    {ready.length === 1 && <Button disabled={!canDownload} onClick={() => { void download(true) }}>{t('ecommerce:export.downloadSingleButton')}</Button>}
    <Button type="primary" disabled={!canDownload} onClick={() => { void download() }}>{t('ecommerce:export.downloadZipButton', { count: ready.length })}</Button>
  </div>}>
    <div className="suite-export-panel">
      <Alert type="info" showIcon message={t('ecommerce:export.infoTitle')} description={t('ecommerce:export.infoDesc')} />
      <fieldset disabled={busy}><legend>{t('ecommerce:export.slotsLegend')}</legend><div className="suite-export-slots">{data.project.config.slots.map(slot => <Checkbox key={slot.id} checked={selected.includes(slot.id)} onChange={event => {
        invalidate(); setSelected(old => event.target.checked ? [...old, slot.id] : old.filter(id => id !== slot.id))
      }}>{slot.order + 1}. {suiteSlotLabel(slot)}{data.project.slotHeads.find(head => head.slotId === slot.id)?.activeVersionId ? '' : t('ecommerce:export.unreadyTag')}</Checkbox>)}</div></fieldset>
      <div className="suite-export-controls">
        <label>{t('ecommerce:export.presetLabel')}<Select disabled={busy} value={output.width === 2000 && output.height === 2000 ? 'square' : output.width === 4096 && output.height === 4096 ? '4k' : 'custom'} onChange={value => { if (value === 'square') patch({ width: 2000, height: 2000 }); if (value === '4k') patch({ width: 4096, height: 4096 }) }} options={[{ value: 'square', label: t('ecommerce:export.presetSquare') }, { value: '4k', label: t('ecommerce:export.preset4k') }, { value: 'custom', label: t('ecommerce:export.presetCustom') }]} /></label>
        <label>{t('ecommerce:export.widthLabel')}<InputNumber disabled={busy} min={1} max={10000} precision={0} value={output.width} onChange={value => patch({ width: value ?? 1 })} /></label>
        <label>{t('ecommerce:export.heightLabel')}<InputNumber disabled={busy} min={1} max={10000} precision={0} value={output.height} onChange={value => patch({ height: value ?? 1 })} /></label>
        <label>{t('ecommerce:export.formatLabel')}<Select disabled={busy} value={output.format} onChange={value => patch({ format: value, ...(value === 'jpeg' && output.background === 'transparent' ? { background: '#ffffff' } : {}) })} options={[{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }, ...(output.platform === 'general' ? [{ value: 'webp', label: 'WebP' }] : [])]} /></label>
        <label>{t('ecommerce:export.qualityLabel')}<InputNumber disabled={busy || output.format === 'png'} min={.1} max={1} step={.05} value={output.jpegQuality} onChange={value => patch({ jpegQuality: value ?? .94 })} /></label>
        <label>{t('ecommerce:export.backgroundLabel')}<Select disabled={busy} value={output.background} onChange={value => patch({ background: value })} options={[{ value: '#ffffff', label: t('ecommerce:export.bgWhite') }, ...(output.format !== 'jpeg' ? [{ value: 'transparent', label: t('ecommerce:export.bgTransparent') }] : []), ...(output.platform === 'general' ? [{ value: '#111827', label: t('ecommerce:export.bgDark') }] : [])]} /></label>
      </div>
      {(error || stale) && <Alert type="error" showIcon message={stale ? t('ecommerce:export.staleAlert') : error} />}
      {busy && <Progress percent={progress} status="active" />}
      {report && !stale && <>
        <p role="status">{t('ecommerce:export.summaryLine', { ready: ready.length, skipped: failures, size: totalSize })}</p>
        <p className="suite-muted">{t('ecommerce:export.ruleLine', { platform: data.project.config.platform === 'amazon' ? t('ecommerce:export.platformSpecs.amazon') : t('ecommerce:export.platformSpecs.general'), ruleVersion: report.ruleVersion, checkedAt: formatDateTime(report.checkedAt) })}</p>
        <div className="suite-export-previews">{ready.map(file => <ExportPreview key={file.versionId} file={file} />)}</div>
        <Collapse items={[{ key: 'project', label: t('ecommerce:export.projectChecksHeading'), children: report.checks.map(check => {
          const localized = localizeSuiteCheck(check, data.project.config.subcategory)
          return <p key={localized.ruleId}><Tag>{t(`ecommerce:export.states.${localized.state}`)}</Tag>{t('ecommerce:export.checks.checkEntry', { title: localized.title, evidence: localized.evidence })}{localized.advice ? ` ${localized.advice}` : ''}{localized.source && <> <a href={localized.source} target="_blank" rel="noreferrer">{t('ecommerce:export.ruleDocLink')}</a></>}</p>
        }) },
          ...files.map(file => ({ key: file.slotId, label: t('ecommerce:export.fileCheckLabel', { name: file.name, status: file.blob ? t('ecommerce:export.filePassed') : t('ecommerce:export.fileFailed') }), children: <>{file.checks.map((check, index) => {
            const localized = localizeSuiteCheck(check, data.project.config.subcategory)
            return <p key={`${localized.ruleId}:${index}`}><Tag color={localized.state === 'fail' ? 'error' : localized.state === 'pass' ? 'success' : 'warning'}>{t(`ecommerce:export.states.${localized.state}`)}</Tag>{t('ecommerce:export.checks.checkEntry', { title: localized.title, evidence: localized.evidence })}{localized.advice ? ` ${localized.advice}` : ''}{localized.source && <> <a href={localized.source} target="_blank" rel="noreferrer">{t('ecommerce:export.ruleDocLink')}</a></>}</p>
          })}</> })),
          ...skipped.map(item => ({ key: item.slotId, label: t('ecommerce:export.skippedSlotLabel', { name: item.name }), children: item.reason }))]} />
        {needsReview && <Checkbox checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}>{t('ecommerce:export.acknowledgeCheckbox')}</Checkbox>}
        {failures > 0 && <Checkbox checked={partial} onChange={event => setPartial(event.target.checked)}>{t('ecommerce:export.partialCheckbox')}</Checkbox>}
      </>}
    </div>
  </Modal>
}
