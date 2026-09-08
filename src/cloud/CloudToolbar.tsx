import { useRef, useState } from 'react'
import { Alert, App, Button, Modal, Space } from 'antd'
import { cloudEnabled, cloudRequest } from './client'
import { forkLocalProject, openCloudProject, syncProject, useCloudStore } from './sync'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { currentSnapshot, flushProject, newProject, replaceSnapshot } from '@/editor/persistence/projectPersistence'
import { readLegacySnapshot } from '@/editor/persistence/database'
import { parseSnapshot } from '@/editor/persistence/snapshot'
import { useEditorStore } from '@/editor/store'
import { uploadImage } from '@/services/api/upload'
import { createImageAsset } from '@/editor/services/assetService'
import { calculateInitialImageNode } from '@/features/free-canvas/geometry'
import { AddNodeCommand } from '@/editor/commands'
import type { ProjectSummary } from '../../shared/cloud'

export default function CloudToolbar({ disabled }: { disabled: boolean }) {
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
    try { await action() } catch (error) { message.error(error instanceof Error ? error.message : '操作失败') }
    finally { setWorking(false); useCloudStore.setState({ interacting: false }) }
  }
  const busy = disabled || working || state.busy
  return <div style={{ width: '100%' }}>
    <Space wrap>
      <span role="status">{state.busy ? state.status : cloud?.conflict ? '云端版本冲突' : cloud?.pending ? '云端待同步' : cloud ? state.status : '仅保存在本机'}</span>
      <Button size="small" disabled={busy || !!cloud?.conflict} onClick={() => { void run(syncProject) }}>保存到云端</Button>
      <Button size="small" disabled={busy} onClick={() => { setReplaceId(undefined); input.current?.click() }}>上传图片</Button>
      <Button size="small" disabled={busy} onClick={() => { void run(async () => setProjects((await cloudRequest<{ items: ProjectSummary[] }>('/projects')).items)) }}>云端项目</Button>
      <Button size="small" disabled={busy} onClick={() => { void run(async () => {
        const raw = await readLegacySnapshot()
        if (!raw) throw new Error('没有未登录时的旧项目')
        const snapshot = parseSnapshot(raw)
        delete snapshot.cloud
        modal.confirm({ title: '导入未登录时的本地项目？', content: '导入后点击保存到云端，才会上传到当前账号。', onOk: async () => { await flushProject(); await replaceSnapshot(snapshot) } })
      }) }}>导入旧本地项目</Button>
    </Space>
    {state.error && <Alert style={{ marginTop: 8 }} type="warning" showIcon message={state.error} />}
    {cloud?.conflict && <Space style={{ marginTop: 8 }}>
      <Button disabled={busy} onClick={() => modal.confirm({ title: '加载云端版本？', content: '当前本地冲突副本已保留，可先导出 JSON。', onOk: () => openCloudProject(currentSnapshot().project.id) })}>加载云端版本</Button>
      <Button disabled={busy} onClick={() => { void run(forkLocalProject) }}>本地另存为新项目</Button>
    </Space>}
    {Object.values(project?.assets ?? {}).filter(asset => asset.missing).map(asset => <div key={asset.id}>
      素材不可用：{asset.name} <Button size="small" disabled={busy} onClick={() => { setReplaceId(asset.id); input.current?.click() }}>重新选择文件</Button>
    </div>)}
    <input type="file" accept="image/png,image/jpeg,image/webp" ref={input} hidden onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''
      if (!file) return
      void run(async () => {
        const targetId = useEditorStore.getState().project?.id
        const uploaded = await uploadImage(file)
        if (useEditorStore.getState().project?.id !== targetId) throw new Error('项目已切换，请重新上传')
        const editor = useEditorStore.getState()
        const scene = editor.project?.document.scenes.find(s => s.id === editor.activeSceneId)
        if (!scene) throw new Error('请先新建画布')
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
            if (Object.values(s.project.generations).some(g => [...g.inputAssetIds,...g.outputAssetIds].includes(replaceId))) assets[replaceId] = s.project.assets[replaceId]
            return { project: { ...s.project, assets } }
          })
          const drafts = usePersistenceStore.getState().drafts
          if (drafts.derived?.sourceAssetId === replaceId) usePersistenceStore.getState().setDrafts({ ...drafts, derived: undefined })
        } else editor.executeCommand(new AddNodeCommand(scene.id, calculateInitialImageNode(asset, scene)))
        await flushProject()
        await syncProject()
      })
    }} />
    <Modal title="云端项目" open={!!projects} footer={null} onCancel={() => setProjects(undefined)}>
      {projects?.length === 0 && <p>暂无云端项目</p>}
      {projects?.map(item => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span>{item.name}</span><Space>
          <Button disabled={busy} onClick={() => { void run(async () => { await openCloudProject(item.id); setProjects(undefined) }) }}>打开</Button>
          <Button danger disabled={busy} onClick={() => modal.confirm({ title: `删除「${item.name}」？`, content: '项目将从云端列表移除，媒体文件暂时保留。', onOk: async () => {
            await cloudRequest(`/projects/${encodeURIComponent(item.id)}`, 'DELETE')
            setProjects(items => items?.filter(p => p.id !== item.id))
            if (project?.id === item.id) await newProject()
          } })}>删除</Button>
        </Space>
      </div>)}
    </Modal>
  </div>
}
