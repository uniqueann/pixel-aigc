import { useRef, useState } from 'react'
import { Alert, App, Button, Modal, Space } from 'antd'
import { useTranslation } from 'react-i18next'
import { cloudEnabled, cloudRequest } from './client'
import { forkLocalProject, openCloudProject, syncProject, useCloudStore } from './sync'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { currentSnapshot, flushProject, newProject, replaceSnapshot } from '@/editor/persistence/projectPersistence'
import { readLegacySnapshot } from '@/editor/persistence/database'
import { parseSnapshot } from '@/editor/persistence/snapshot'
import { useEditorStore } from '@/editor/store'
import { imageFileError, uploadImage } from '@/services/api/upload'
import { createImageAsset } from '@/editor/services/assetService'
import { calculateInitialImageNode } from '@/features/free-canvas/geometry'
import { AddNodeCommand } from '@/editor/commands'
import type { ProjectSummary } from '../../shared/cloud'

export default function CloudToolbar({ disabled, onUploadImage }: { disabled: boolean; onUploadImage?: () => void }) {
  const { t } = useTranslation(['auth', 'common'])
  const state = useCloudStore()
  const cloud = usePersistenceStore(s => s.cloud)
  const project = useEditorStore(s => s.project)
  const [projects, setProjects] = useState<ProjectSummary[] | undefined>()
  const [working, setWorking] = useState(false)
  const [replaceId, setReplaceId] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  const { message, modal } = App.useApp()
  if (!cloudEnabled) return null
  const run = async (action: () => Promise<unknown>) => {
    setWorking(true)
    useCloudStore.setState({ interacting: true })
    try { await action() } catch (error) { message.error(error instanceof Error ? error.message : t('auth:cloudToolbar.actionFailed')) }
    finally { setWorking(false); useCloudStore.setState({ interacting: false }) }
  }
  const busy = disabled || working || state.busy
  const hasVideo = Object.values(project?.assets ?? {}).some(asset => asset.type === 'video')
  return <div style={{ width: '100%' }}>
    <Space wrap>
      <span role="status">{state.busy ? state.status : cloud?.conflict ? t('auth:cloudToolbar.conflict') : cloud?.pending ? t('auth:cloudToolbar.pending') : cloud ? state.status : t('auth:cloudToolbar.localOnly')}</span>
      <Button size="small" disabled={busy || !!cloud?.conflict || hasVideo} onClick={() => { void run(syncProject) }}>{t('auth:cloudToolbar.saveToCloud')}</Button>
      {!onUploadImage && <Button size="small" disabled={busy} onClick={() => { setReplaceId(undefined); input.current?.click() }}>{t('auth:cloudToolbar.uploadImage')}</Button>}
      <Button size="small" disabled={busy} onClick={() => { void run(async () => setProjects((await cloudRequest<{ items: ProjectSummary[] }>('/projects')).items)) }}>{t('auth:cloudToolbar.cloudProjects')}</Button>
      <Button size="small" disabled={busy} onClick={() => { void run(async () => {
        const raw = await readLegacySnapshot()
        if (!raw) throw new Error(t('auth:cloudToolbar.noLegacyProject'))
        const snapshot = parseSnapshot(raw)
        delete snapshot.cloud
        modal.confirm({ title: t('auth:cloudToolbar.importLegacyTitle'), content: t('auth:cloudToolbar.importLegacyContent'), okText: t('common:actions.confirm'), cancelText: t('common:actions.cancel'), onOk: async () => { await flushProject(); await replaceSnapshot(snapshot) } })
      }) }}>{t('auth:cloudToolbar.importLegacy')}</Button>
    </Space>
    <p className="free-canvas-panel-hint">{t('auth:cloudToolbar.hint')}</p>
    {hasVideo && <p role="status">{t('auth:cloudToolbar.videoLocalOnlyHint')}</p>}
    {state.error && <Alert style={{ marginTop: 8 }} type="warning" showIcon message={state.error} />}
    {cloud?.conflict && <Space style={{ marginTop: 8 }}>
      <Button disabled={busy} onClick={() => modal.confirm({ title: t('auth:cloudToolbar.loadCloudTitle'), content: t('auth:cloudToolbar.loadCloudContent'), okText: t('common:actions.confirm'), cancelText: t('common:actions.cancel'), onOk: () => openCloudProject(currentSnapshot().project.id) })}>{t('auth:cloudToolbar.loadCloudVersion')}</Button>
      <Button disabled={busy} onClick={() => { void run(forkLocalProject) }}>{t('auth:cloudToolbar.forkLocal')}</Button>
    </Space>}
    {Object.values(project?.assets ?? {}).filter(asset => asset.missing).map(asset => <div key={asset.id}>
      {t('auth:cloudToolbar.assetMissing', { name: asset.name })} <Button size="small" disabled={busy} onClick={() => { setReplaceId(asset.id); input.current?.click() }}>{t('auth:cloudToolbar.reselectFile')}</Button>
    </div>)}
    <input type="file" accept="image/png,image/jpeg,image/webp" ref={input} hidden onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''
      if (!file) return
      // 选图时先做同步体积检查，避免进入上传流程后才报错。
      const invalid = imageFileError(file)
      if (invalid) { message.error(invalid); return }
      void run(async () => {
        const targetId = useEditorStore.getState().project?.id
        const uploaded = await uploadImage(file)
        if (useEditorStore.getState().project?.id !== targetId) throw new Error(t('auth:cloudToolbar.projectSwitched'))
        const editor = useEditorStore.getState()
        const scene = editor.project?.document.scenes.find(s => s.id === editor.activeSceneId)
        if (!scene) throw new Error(t('auth:cloudToolbar.createCanvasFirst'))
        // 替换使用新素材 ID，旧 R2 对象保持不可变。
        const asset = createImageAsset({ ...uploaded })
        editor.registerAsset(asset)
        if (replaceId) {
          for (const s of editor.project!.document.scenes) for (const n of s.nodes) if ((n.type === 'image' || n.type === 'video') && n.assetId === replaceId)
            editor.updateNode(s.id, n.id, { assetId: asset.id })
          useEditorStore.setState(s => {
            if (!s.project) return s
            const assets = { ...s.project.assets }; delete assets[replaceId]
            // 本地历史 Generation 仍引用旧素材时保留元数据，避免破坏历史存档。
            if (Object.values(s.project.generations).some(g => [...g.inputAssetIds, ...g.outputAssetIds].includes(replaceId))) assets[replaceId] = s.project.assets[replaceId]
            return { project: { ...s.project, assets } }
          })
          const drafts = usePersistenceStore.getState().drafts
          if (drafts.derived?.sourceAssetId === replaceId) usePersistenceStore.getState().setDrafts({ ...drafts, derived: undefined })
        } else editor.executeCommand(new AddNodeCommand(scene.id, calculateInitialImageNode(asset, scene)))
        await flushProject()
        await syncProject()
      })
    }} />
    <Modal title={t('auth:cloudToolbar.cloudProjects')} open={!!projects} footer={null} onCancel={() => setProjects(undefined)}>
      {projects?.length === 0 && <p>{t('auth:cloudToolbar.noCloudProjects')}</p>}
      {projects?.map(item => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span>{item.name}</span><Space>
          <Button disabled={busy} onClick={() => { void run(async () => { await openCloudProject(item.id); setProjects(undefined) }) }}>{t('common:actions.open')}</Button>
          <Button danger disabled={busy} onClick={() => modal.confirm({ title: t('auth:cloudToolbar.deleteConfirmTitle', { name: item.name }), content: t('auth:cloudToolbar.deleteConfirmContent'), okText: t('common:actions.delete'), cancelText: t('common:actions.cancel'), onOk: async () => {
            await cloudRequest(`/projects/${encodeURIComponent(item.id)}`, 'DELETE')
            setProjects(items => items?.filter(p => p.id !== item.id))
            if (project?.id === item.id) await newProject()
          } })}>{t('common:actions.delete')}</Button>
        </Space>
      </div>)}
    </Modal>
  </div>
}
