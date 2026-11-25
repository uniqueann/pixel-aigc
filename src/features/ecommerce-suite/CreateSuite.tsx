import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Modal, Steps } from 'antd'
import { useTranslation } from 'react-i18next'
import { CloudError } from '@/cloud/client'
import { formatMegabytes } from '@/i18n/format'
import type { SuiteActor } from '@shared/ecommerce-suite'
import { suiteProjectConfigSchema } from '@shared/ecommerce-suite'
import { normalizeImageBlob } from '@shared/image-format'
import CanvasAssetPicker from '@/features/free-canvas/images/CanvasAssetPicker'
import { readOwnedImage } from '@/services/api/ownedImages'
import type { SuiteClient } from './api'
import { newSuiteConfig } from './config'
import { createSuiteProject } from './createProject'
import { readSuiteCreation, saveSuiteCreation } from './backup'
import { formatSuiteError } from './i18n'
import ProductFields from './ProductFields'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export default function CreateSuite({ actor, client, onClose, onCreated }: { actor: SuiteActor; client: SuiteClient; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation('ecommerce')
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
      if (blob.size > MAX_UPLOAD_BYTES) throw new Error(t('create.errors.imageTooLarge', { mb: formatMegabytes(MAX_UPLOAD_BYTES) }))
      const normalized = await normalizeImageBlob(blob)
      client.assertCurrent(); if (alive.current) { setImage(normalized); setError('') }
    } catch (error) { if (alive.current) setError(formatSuiteError(error, 'ecommerce:create.errors.imageUnavailable')) }
  }
  const create = async () => {
    setBusy(true); setError('')
    try {
      if (!image) throw new Error(t('create.errors.uploadBaseFirst'))
      const validated = suiteProjectConfigSchema.parse(config)
      // 本机草稿只用于中断后找回；写入失败不能阻断云端创建。
      await saveSuiteCreation(actor, { requestId: requestId.current, config: validated, image }).catch(() => undefined)
      const created = await createSuiteProject(client, requestId.current, validated, async next => {
        requestId.current = next
        await saveSuiteCreation(actor, { requestId: next, config: validated, image }).catch(() => undefined)
      })
      requestId.current = created.requestId
      if (created.recovered) message.info(t('create.recoveredNotice'))
      // 底图编号在创建时预留，服务器不允许同一编号覆盖成另一张图。若项目已存有上次的底图
      // （响应丢失后换图重试），保留原图并继续进入工作台，不能把已成功的创建当成失败。
      const stored = await client.upload(created.project.id, created.project.config.baseAssetId, image, t('upload.baseAssetName'))
        .then(() => true, error => {
          if (error instanceof CloudError && error.code === 'SUITE_REQUEST_CONFLICT') return false
          throw error
        })
      if (!stored) message.warning(t('create.keptExistingBaseWarning'))
      client.assertCurrent()
      await saveSuiteCreation(actor, undefined).catch(() => undefined)
      if (alive.current) onCreated(created.project.id)
    } catch (error) { if (alive.current) setError(formatSuiteError(error, 'ecommerce:create.errors.saveFailed')) }
    finally { if (alive.current) setBusy(false) }
  }
  return <Modal open title={t('create.title')} width={780} onCancel={busy ? undefined : onClose} maskClosable={false} footer={<div className="suite-actions">
    {step > 0 && <Button disabled={busy} onClick={() => setStep(0)}>{t('create.prevStep')}</Button>}
    {step === 0 ? <Button type="primary" disabled={!image} onClick={() => setStep(1)}>{t('create.nextStep')}</Button>
      : <Button type="primary" loading={busy} onClick={() => { void create() }}>{t('create.submitButton')}</Button>}
  </div>}>
    <Steps size="small" current={step} items={[{ title: t('create.steps.upload') }, { title: t('create.steps.fields') }]} />
    {error && <Alert showIcon type="error" message={error} />}
    {step === 0 ? <div className="suite-create-image">
      <p>{t('create.uploadPrompt')}</p>
      {image && <img ref={img} alt={t('create.imagePreviewAlt')} />}
      <label className="suite-file-button">{t('create.chooseLocalImage')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void choose(file); event.target.value = '' }} /></label>
      <Button disabled={busy} onClick={() => setPicker(true)}>{t('create.chooseFromAssets')}</Button>
      <p className="suite-muted">{t('create.formatHint', { mb: formatMegabytes(MAX_UPLOAD_BYTES) })}</p>
    </div> : <ProductFields value={config} onChange={setConfig} creating disabled={busy} />}
    {picker && <CanvasAssetPicker ownerId={actor.userId} targetLabel={t('create.pickerTargetLabel')} busy={busy} onClose={() => setPicker(false)} onSelect={async record => {
      try {
        if (record.runtimeScope !== actor.runtimeScope) throw new Error(t('create.errors.scopeMismatch'))
        setBusy(true)
        const blob = await readOwnedImage({ objectKey: record.objectKey, historyId: record.id }, { ownerId: actor.userId })
        client.assertCurrent(); await choose(blob); if (alive.current) setPicker(false)
      } catch (error) { if (alive.current) setError(formatSuiteError(error, 'ecommerce:create.errors.assetLoadFailed')) }
      finally { if (alive.current) setBusy(false) }
    }} />}
  </Modal>
}
