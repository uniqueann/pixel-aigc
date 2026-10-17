import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Collapse, Image, InputNumber, Modal, Progress, Select, Tag } from 'antd'
import type { SuiteActor } from '@shared/ecommerce-suite'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import { suiteChecksFailed, type SuiteExportConfig, type SuitePrecheck } from '@shared/ecommerce-suite-precheck'
import { suiteExportConfigSchema } from '@shared/ecommerce-suite'
import { downloadBlob } from '@/pages/Toolbox/shared/zip'
import type { SuiteClient } from './api'
import { backupAssetBlob } from './recoveryPackage'
import { encodeSuiteSelection, zipSuiteExport, type SuiteExportedFile, type SuiteExportSkip } from './export'

const stateNames = { pass: '通过', warning: '警告', unknown: '未知', fail: '失败' }
function ExportPreview({ file }: { file: SuiteExportedFile }) {
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
        if (!ctx) throw new Error('缩略预览不可用')
        ctx.drawImage(image, 0, 0)
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
        if (!disposed && blob) { thumbnail = URL.createObjectURL(blob); setUrls({ thumbnail, original }) }
      } finally { image.close(); canvas.width = 1; canvas.height = 1 }
    })().catch(() => { if (!disposed) setUrls(undefined) })
    return () => { disposed = true; URL.revokeObjectURL(original); if (thumbnail) URL.revokeObjectURL(thumbnail) }
  }, [file.blob, file.metadata?.height, file.metadata?.width])
  return urls ? <figure><Image src={urls.thumbnail} preview={{ src: urls.original }} alt={`${file.name}实际编码成品`} width={150} /><figcaption>{file.metadata?.width}×{file.metadata?.height} · 点击核对</figcaption></figure> : null
}
export default function ExportPanel({ actor, data, client, signal, liveKey, initialSlotId, prepare, onClose }: {
  actor: SuiteActor; data: SuiteProjectDetail; client: SuiteClient; signal: AbortSignal; liveKey: string; initialSlotId?: string
  prepare: (slotIds: string[]) => Promise<SuiteProjectDetail>; onClose: () => void
}) {
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
          else missing.push({ slotId: id, name: slot.name, reason: '尚无已选用成品；失败或活动任务不会阻止其他槽位导出' })
        }
        setSkipped(missing)
        if (!versions.length) throw new Error('所选槽位没有已保存成品，请先选用候选版本')
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
      if (expectedKey !== currentKey.current) throw new Error('编码期间项目或图层已变化，请重新预检')
      setReport(frozen); setFiles(encoded)
    } catch (error) { if (!signal.aborted) setError(run.signal.aborted ? '已取消，可以重新预检' : error instanceof Error ? error.message : '平台预检失败') }
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
      if (latest.fingerprint !== report.fingerprint) { setReport(undefined); setFiles([]); throw new Error('云端项目或当前版本已变化，请重新预检') }
      run.signal.throwIfAborted()
      if (single && ready.length === 1) downloadBlob(ready[0].blob!, ready[0].name)
      else {
        const zip = await zipSuiteExport(report, files, skipped, acknowledged, partial)
        run.signal.throwIfAborted()
        client.assertCurrent()
        if (verifiedKey !== currentKey.current) throw new Error('项目已变化，请重新预检')
        downloadBlob(zip, ready[0].name.replace(/\.[^.]+$/, '') + '_成品包.zip')
      }
    } catch (error) { if (!signal.aborted) setError(error instanceof Error ? error.message : '打包失败，可以重试下载') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  return <Modal open title="平台预检与成品导出" width={960} onCancel={() => { controller.current?.abort(); onClose() }} footer={<div className="suite-actions">
    {busy && <Button onClick={() => controller.current?.abort()}>取消处理</Button>}
    <Button disabled={busy || !selected.length} onClick={() => { void check() }}>保存所选成品并预检</Button>
    {report && !stale && files.some(file => file.error) && <Button disabled={busy} onClick={() => { void check(true) }}>仅重试失败文件</Button>}
    {ready.length === 1 && <Button disabled={!canDownload} onClick={() => { void download(true) }}>下载单图</Button>}
    <Button type="primary" disabled={!canDownload} onClick={() => { void download() }}>下载 {ready.length} 张成品 ZIP</Button>
  </div>}>
    <div className="suite-export-panel">
      <Alert type="info" showIcon message="检查结果供发布前核对，不代表平台审核通过" description="导出会冻结所选成品及图层，逐张合成并检查实际文件；原图完整置入、不自动裁切。修改设置或版本后需重新预检。普通导出不产生生成费用。" />
      <fieldset disabled={busy}><legend>选择槽位</legend><div className="suite-export-slots">{data.project.config.slots.map(slot => <Checkbox key={slot.id} checked={selected.includes(slot.id)} onChange={event => {
        invalidate(); setSelected(old => event.target.checked ? [...old, slot.id] : old.filter(id => id !== slot.id))
      }}>{slot.order + 1}. {slot.name}{data.project.slotHeads.find(head => head.slotId === slot.id)?.activeVersionId ? '' : '（无当前成品）'}</Checkbox>)}</div></fieldset>
      <div className="suite-export-controls">
        <label>输出预设<Select disabled={busy} value={output.width === 2000 && output.height === 2000 ? 'square' : output.width === 4096 && output.height === 4096 ? '4k' : 'custom'} onChange={value => { if (value === 'square') patch({ width: 2000, height: 2000 }); if (value === '4k') patch({ width: 4096, height: 4096 }) }} options={[{ value: 'square', label: '2000×2000（产品预设）' }, { value: '4k', label: '4096×4096' }, { value: 'custom', label: '自定义像素' }]} /></label>
        <label>宽度（px）<InputNumber disabled={busy} min={1} max={10000} precision={0} value={output.width} onChange={value => patch({ width: value ?? 1 })} /></label>
        <label>高度（px）<InputNumber disabled={busy} min={1} max={10000} precision={0} value={output.height} onChange={value => patch({ height: value ?? 1 })} /></label>
        <label>文件格式<Select disabled={busy} value={output.format} onChange={value => patch({ format: value, ...(value === 'jpeg' && output.background === 'transparent' ? { background: '#ffffff' } : {}) })} options={[{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }, ...(output.platform === 'general' ? [{ value: 'webp', label: 'WebP' }] : [])]} /></label>
        <label>JPEG／WebP 质量<InputNumber disabled={busy || output.format === 'png'} min={.1} max={1} step={.05} value={output.jpegQuality} onChange={value => patch({ jpegQuality: value ?? .94 })} /></label>
        <label>透明与铺底<Select disabled={busy} value={output.background} onChange={value => patch({ background: value })} options={[{ value: '#ffffff', label: '不透明白底' }, ...(output.format !== 'jpeg' ? [{ value: 'transparent', label: '保留透明' }] : []), ...(output.platform === 'general' ? [{ value: '#111827', label: '深色铺底' }] : [])]} /></label>
      </div>
      {(error || stale) && <Alert type="error" showIcon message={stale ? '项目、图层或当前版本已变化，请重新预检' : error} />}
      {busy && <Progress percent={progress} status="active" />}
      {report && !stale && <>
        <p role="status">{ready.length} 张成品可导出，{failures} 项失败或跳过；实际成品合计 {(ready.reduce((sum, file) => sum + file.blob!.size, 0) / 1024 / 1024).toFixed(2)} MB。ZIP 总量上限 200 MB。</p>
        <p className="suite-muted">规则 {report.ruleVersion} · 复核于 {report.ruleReviewedAt} · 检查于 {new Date(report.checkedAt).toLocaleString()}</p>
        <div className="suite-export-previews">{ready.map(file => <ExportPreview key={file.versionId} file={file} />)}</div>
        <Collapse items={[{ key: 'project', label: '平台与规则', children: report.checks.map(check => <p key={check.ruleId}><Tag>{stateNames[check.state]}</Tag>{check.title}：{check.evidence} {check.advice}{check.source && <> <a href={check.source} target="_blank" rel="noreferrer">规则来源</a></>}</p>) },
          ...files.map(file => ({ key: file.slotId, label: `${file.name} · ${file.blob ? '文件已编码' : '无法导出'}`, children: <>{file.checks.map((check, index) => <p key={`${check.ruleId}:${index}`}><Tag color={check.state === 'fail' ? 'error' : check.state === 'pass' ? 'success' : 'warning'}>{stateNames[check.state]}</Tag>{check.title}：{check.evidence} {check.advice}{check.source && <> <a href={check.source} target="_blank" rel="noreferrer">规则来源</a></>}</p>)}</> })),
          ...skipped.map(item => ({ key: item.slotId, label: `${item.name} · 跳过`, children: item.reason }))]} />
        {needsReview && <Checkbox checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}>我已对照原图、输出文件和目标类目要求核对警告及未知项。</Checkbox>}
        {failures > 0 && <Checkbox checked={partial} onChange={event => setPartial(event.target.checked)}>确认仅导出成功项，跳过原因写入 ZIP 清单。</Checkbox>}
      </>}
    </div>
  </Modal>
}
