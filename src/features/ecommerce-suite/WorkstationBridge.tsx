import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Select } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useUserStore } from '@/store/useUserStore'
import type { SuiteActor } from '@shared/ecommerce-suite'
import type { SuiteBridgeDetail } from '@shared/ecommerce-suite-runtime'
import type { GenerationTask } from '@/types'
import { suiteClient } from './api'
import { backupAssetBlob } from './recoveryPackage'

export interface WorkstationSuiteBinding { id: string; inputObjectKey: string }
export default function WorkstationBridge({ id, tool, task, disabled, onInput, onBinding }: {
  id: string; tool: string; task?: GenerationTask<unknown>; disabled: boolean;
  onInput: (detail: SuiteBridgeDetail, blob: Blob, actor: SuiteActor) => void;
  onBinding: (binding: WorkstationSuiteBinding | undefined) => void
}) {
  const account = useUserStore(state => state.account)
  const owner = account?.userId, scope = account?.runtimeScope
  const navigate = useNavigate(), { message } = App.useApp()
  const [detail, setDetail] = useState<SuiteBridgeDetail>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string>()
  const [lifetime, setLifetime] = useState<AbortController>()
  useEffect(() => {
    const abort = new AbortController()
    queueMicrotask(() => { if (!abort.signal.aborted) setLifetime(abort) })
    return () => abort.abort()
  }, [])
  const runtime = useMemo(() => {
    if (!owner || !scope || !lifetime) return undefined
    const actor = { userId: owner, runtimeScope: scope }
    const abort = lifetime
    return { actor, abort, client: suiteClient(actor, abort.signal) }
  }, [owner, scope, lifetime])
  useEffect(() => {
    if (!runtime) return
    let disposed = false
    onBinding(undefined)
    void (async () => {
      const data = await runtime.client.bridge(id)
      if (data.bridge.tool !== tool) throw new Error('当前工具与会话不一致，请从套图重新进入对应工具')
      const blob = await backupAssetBlob(runtime.actor, data.asset, runtime.abort.signal)
      runtime.client.assertCurrent()
      if (disposed) return
      onInput(data, blob, runtime.actor)
      onBinding({ id: data.bridge.id, inputObjectKey: data.asset.objectKey })
      setDetail(data); setError('')
    })().catch(error => { if (!disposed && !runtime.abort.signal.aborted) setError(error instanceof Error ? error.message : '会话恢复失败') })
    return () => { disposed = true; onBinding(undefined) }
  }, [id, runtime, tool, onInput, onBinding])
  useEffect(() => {
    if (!runtime || task?.status !== 'succeeded') return
    let disposed = false
    void runtime.client.bridge(id).then(data => { if (!disposed) setDetail(data) }).catch(error => { if (!disposed && !runtime.abort.signal.aborted) setError(error.message) })
    return () => { disposed = true }
  }, [id, runtime, task?.id, task?.status])
  const results = detail?.availableResults ?? []
  const key = (value: typeof results[number]) => `${value.sourceKind}:${value.sourceId}:${value.ordinal}`
  const result = results.find(result => key(result) === selected) ?? results[0]
  const perform = async (action: () => Promise<void>) => {
    if (!runtime) return
    setBusy(true)
    try { await action(); setError('') }
    catch (error) { if (!runtime.abort.signal.aborted) setError(error instanceof Error ? error.message : '操作失败') }
    finally { if (!runtime.abort.signal.aborted) setBusy(false) }
  }
  return <Alert className="suite-workstation-bridge" type={error ? 'warning' : 'info'} showIcon message={error || `电商套图工作站会话${detail ? ` · 来源版本 ${detail.version.versionNumber}` : ' · 正在恢复'}`}
    description={<div>
      <p>原工具按原规则收费。回填只保存已有成功结果为候选，不覆盖当前成品；{detail?.bridge.inputMode === 'composite' ? '输入已包含烘焙文字，回填不重复叠加图层。' : '独立图层保留在套图中。'}会话有效期七天。</p>
      <div className="suite-actions">
        <Button disabled={disabled || busy || !runtime} onClick={() => { void perform(async () => { const data = await runtime!.client.bridge(id); setDetail(data) }) }}>刷新本会话成功结果</Button>
        <Button disabled={disabled || busy || !detail} onClick={() => { void perform(async () => {
          const data = await runtime!.client.bridge(id), blob = await backupAssetBlob(runtime!.actor, data.asset, runtime!.abort.signal)
          runtime!.client.assertCurrent(); onInput(data, blob, runtime!.actor); onBinding({ id, inputObjectKey: data.asset.objectKey }); setDetail(data)
        }) }}>重新载入会话输入</Button>
        {detail && <Button onClick={() => navigate(`/ecommerce/${detail.bridge.projectId}?slot=${detail.bridge.slotId}`)}>返回套图查看候选</Button>}
      </div>
      {results.length > 0 && <div className="suite-actions">
        <Select aria-label="回填成功结果" value={result && key(result)} options={results.map(item => ({ value: key(item), label: `原任务 ${item.sourceId.slice(0,8)} · 候选 ${item.ordinal + 1}${detail?.returns.some(old => key(old) === key(item)) ? '（已回填）' : ''}` }))} onChange={setSelected} />
        <Button type="primary" disabled={disabled || busy || !result} loading={busy} onClick={() => { void perform(async () => {
          const returned = await runtime!.client.returnBridge(id, crypto.randomUUID(), result!)
          runtime!.client.assertCurrent(); setDetail(await runtime!.client.bridge(id))
          message.success(`已保存候选版本 ${returned.version.versionNumber}${returned.sizeChanged ? '，画板尺寸已变化，请重新核对图层' : returned.sourceChanged ? '，来源已变化，请手动选用' : '，请回套图手动选用'}`)
        }) }}>回填到电商套图</Button>
      </div>}
    </div>} />
}
