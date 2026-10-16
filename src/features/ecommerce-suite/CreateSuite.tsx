import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Steps } from 'antd'
import type { SuiteActor } from '@shared/ecommerce-suite'
import { suiteProjectConfigSchema } from '@shared/ecommerce-suite'
import { normalizeImageBlob } from '@shared/image-format'
import CanvasAssetPicker from '@/features/free-canvas/images/CanvasAssetPicker'
import { readOwnedImage } from '@/services/api/ownedImages'
import type { SuiteClient } from './api'
import { newSuiteConfig } from './config'
import { readSuiteCreation, saveSuiteCreation } from './backup'
import ProductFields from './ProductFields'

export default function CreateSuite({ actor, client, onClose, onCreated }: { actor: SuiteActor; client: SuiteClient; onClose: () => void; onCreated: (id: string) => void }) {
  const [config, setConfig] = useState(newSuiteConfig)
  const [image, setImage] = useState<Blob>()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [picker, setPicker] = useState(false)
  const requestId = useRef<string>(crypto.randomUUID())
  const img = useRef<HTMLImageElement>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    void readSuiteCreation(actor).then(draft => { client.assertCurrent(); if (alive.current && draft) { requestId.current = draft.requestId; setConfig(draft.config); setImage(draft.image) } }).catch(() => undefined)
    return () => { alive.current = false }
  }, [actor, client])
  useEffect(() => {
    if (!image || !img.current) return
    const url = URL.createObjectURL(image), element = img.current
    element.src = url
    return () => { element.removeAttribute('src'); URL.revokeObjectURL(url) }
  }, [image, step])
  const choose = async (blob: Blob) => {
    try {
      if (blob.size > 20 * 1024 * 1024) throw new Error('图片大小不能超过 20 MiB')
      const normalized = await normalizeImageBlob(blob)
      client.assertCurrent(); if (alive.current) { setImage(normalized); setError('') }
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : '图片不可用') }
  }
  const create = async () => {
    setBusy(true); setError('')
    try {
      if (!image) throw new Error('请先上传商品主体照片')
      const validated = suiteProjectConfigSchema.parse(config)
      await saveSuiteCreation(actor, { requestId: requestId.current, config: validated, image })
      let project
      try { project = await client.create(requestId.current, validated) }
      catch (error) { project = await client.findCreate(requestId.current); if (!project) throw error }
      await client.upload(project.id, validated.baseAssetId, image, '商品主体图')
      client.assertCurrent()
      await saveSuiteCreation(actor, undefined)
      if (alive.current) onCreated(project.id)
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : '保存失败，资料已保留') }
    finally { if (alive.current) setBusy(false) }
  }
  return <Modal open title="新建电商套图" width={780} onCancel={busy ? undefined : onClose} maskClosable={false} footer={<div className="suite-actions">
    {step > 0 && <Button disabled={busy} onClick={() => setStep(0)}>上一步</Button>}
    {step === 0 ? <Button type="primary" disabled={!image} onClick={() => setStep(1)}>下一步：确认商品资料</Button>
      : <Button type="primary" loading={busy} onClick={() => { void create() }}>保存项目并进入</Button>}
  </div>}>
    <Steps size="small" current={step} items={[{ title: '商品图片' }, { title: '商品资料与槽位' }]} />
    {error && <Alert showIcon type="error" message={error} />}
    {step === 0 ? <div className="suite-create-image">
      <p>上传一张真实商品照片。建议主体清晰、配件完整；生成后仍需核对外观与细节。</p>
      {image && <img ref={img} alt="待保存的商品主体照片" />}
      <label className="suite-file-button">选择本地图片<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void choose(file); event.target.value = '' }} /></label>
      <Button disabled={busy} onClick={() => setPicker(true)}>从我的资产选择</Button>
      <p className="suite-muted">静态 JPEG、PNG、WebP，最多 20 MiB。保存项目不会开始生成或扣除积分。</p>
    </div> : <ProductFields value={config} onChange={next => { requestId.current = crypto.randomUUID(); setConfig(next) }} creating disabled={busy} />}
    {picker && <CanvasAssetPicker ownerId={actor.userId} targetLabel="套图" busy={busy} onClose={() => setPicker(false)} onSelect={async record => {
      try {
        if (record.runtimeScope !== actor.runtimeScope) throw new Error('该图片来源环境与当前项目不一致，请下载后作为本地图片上传')
        setBusy(true)
        const blob = await readOwnedImage({ objectKey: record.objectKey, historyId: record.id }, { ownerId: actor.userId })
        client.assertCurrent(); await choose(blob); if (alive.current) setPicker(false)
      } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : '资产读取失败') }
      finally { if (alive.current) setBusy(false) }
    }} />}
  </Modal>
}
