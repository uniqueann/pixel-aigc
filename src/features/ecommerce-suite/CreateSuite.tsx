import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Modal, Steps } from 'antd'
import { CloudError } from '@/cloud/client'
import type { SuiteActor } from '@shared/ecommerce-suite'
import { suiteProjectConfigSchema } from '@shared/ecommerce-suite'
import { normalizeImageBlob } from '@shared/image-format'
import CanvasAssetPicker from '@/features/free-canvas/images/CanvasAssetPicker'
import { readOwnedImage } from '@/services/api/ownedImages'
import type { SuiteClient } from './api'
import { newSuiteConfig } from './config'
import { createSuiteProject } from './createProject'
import { readSuiteCreation, saveSuiteCreation } from './backup'
import ProductFields from './ProductFields'

export default function CreateSuite({ actor, client, onClose, onCreated }: { actor: SuiteActor; client: SuiteClient; onClose: () => void; onCreated: (id: string) => void }) {
  const { message } = App.useApp()
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
      // 本机草稿只用于中断后找回；写入失败不能阻断云端创建。
      await saveSuiteCreation(actor, { requestId: requestId.current, config: validated, image }).catch(() => undefined)
      const created = await createSuiteProject(client, requestId.current, validated, async next => {
        requestId.current = next
        await saveSuiteCreation(actor, { requestId: next, config: validated, image }).catch(() => undefined)
      })
      requestId.current = created.requestId
      if (created.recovered) message.info('上次创建请求已完成，已打开原项目；本次资料修改可在工作台继续')
      // 底图编号在创建时预留，服务器不允许同一编号覆盖成另一张图。若项目已存有上次的底图
      // （响应丢失后换图重试），保留原图并继续进入工作台，不能把已成功的创建当成失败。
      const stored = await client.upload(created.project.id, created.project.config.baseAssetId, image, '商品主体图')
        .then(() => true, error => {
          if (error instanceof CloudError && error.code === 'SUITE_REQUEST_CONFLICT') return false
          throw error
        })
      if (!stored) message.warning('原项目已保留上次的商品主体图，本次选择的图片未上传；进入工作台后可替换主体图')
      client.assertCurrent()
      await saveSuiteCreation(actor, undefined).catch(() => undefined)
      if (alive.current) onCreated(created.project.id)
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : '保存失败，资料已保留') }
    finally { if (alive.current) setBusy(false) }
  }
  return <Modal open title="新建电商套图" width={780} onCancel={busy ? undefined : onClose} maskClosable={false} footer={<div className="suite-actions">
    {step > 0 && <Button disabled={busy} onClick={() => setStep(0)}>上一步</Button>}
    {step === 0 ? <Button type="primary" disabled={!image} onClick={() => setStep(1)}>下一步：设置商品信息</Button>
      : <Button type="primary" loading={busy} onClick={() => { void create() }}>创建并进入工作台</Button>}
  </div>}>
    <Steps size="small" current={step} items={[{ title: '上传商品图' }, { title: '商品信息与规格' }]} />
    {error && <Alert showIcon type="error" message={error} />}
    {step === 0 ? <div className="suite-create-image">
      <p>请上传一张清晰的商品主体照片（白底图或实拍图均可）。</p>
      {image && <img ref={img} alt="待保存的商品主体照片" />}
      <label className="suite-file-button">选择本地图片<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void choose(file); event.target.value = '' }} /></label>
      <Button disabled={busy} onClick={() => setPicker(true)}>从我的资产选择</Button>
      <p className="suite-muted">支持 JPG、PNG、WebP 格式，最大 20 MB。创建项目暂不消耗积分。</p>
    </div> : <ProductFields value={config} onChange={setConfig} creating disabled={busy} />}
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
