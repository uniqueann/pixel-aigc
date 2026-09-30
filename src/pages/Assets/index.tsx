import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DownloadOutlined, DeleteOutlined, ZoomInOutlined } from '@ant-design/icons'
import { App, Button, Card, Segmented, Space, Spin } from 'antd'
import EmptyState from '@/components/EmptyState'
import PreviewGallery, { type PreviewItem } from '@/components/PreviewGallery'
import { usePreviewGallery } from '@/components/usePreviewGallery'
import { authEnabled } from '@/cloud/client'
import {
  capabilityLabel,
  emailOperationLabel,
  taskStatusLabel,
  workstationToolLabel,
} from '@/features/assets/labels'
import { hydrateWorkstationHistoryFromImageJobs } from '@/features/assets/hydrateImageJobs'
import { isCurrentWorkstationHistoryOwner, resolveWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import {
  deleteWorkstationHistory,
  listWorkstationHistory,
  type WorkstationHistoryRecord,
} from '@/features/assets/workstationHistory'
import { downloadFailureMessage, downloadImageSource, filenameForWorkstationResult } from '@/features/image-workstation/download'
import { listTasks, type TaskSummary } from '@/services/api/task'
import { Capability } from '@/types'
import { useUserStore } from '@/store/useUserStore'

type Filter = 'all' | 'workstation' | 'email'

interface LibraryItem {
  id: string
  kind: 'workstation' | 'email'
  title: string
  subtitle: string
  status: string
  createdAt: string
  previewUrl?: string
  prompt?: string
  record?: WorkstationHistoryRecord
  email?: TaskSummary
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

export default function Assets() {
  const userId = useUserStore((state) => state.userId)
  let ownerId: string
  try {
    ownerId = resolveWorkstationHistoryOwner(authEnabled, userId)
  } catch {
    return <EmptyState description="登录账号尚未就绪，无法读取历史任务" />
  }
  return <AssetsForOwner key={ownerId} ownerId={ownerId} />
}

function AssetsForOwner({ ownerId }: { ownerId: string }) {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [hydrating, setHydrating] = useState(authEnabled)
  const [workstationItems, setWorkstationItems] = useState<WorkstationHistoryRecord[]>([])
  const [emailItems, setEmailItems] = useState<TaskSummary[]>([])
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const previewUrlsRef = useRef<Record<string, string>>({})
  const [downloadingId, setDownloadingId] = useState<string>()

  const refresh = useCallback(async (isActive: () => boolean, showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      if (!isActive()) return
      const local = await listWorkstationHistory(ownerId)
      if (!isActive()) return
      const nextUrls: Record<string, string> = {}
      for (const item of local) nextUrls[item.id] = URL.createObjectURL(item.result)
      if (!isActive()) {
        for (const url of Object.values(nextUrls)) URL.revokeObjectURL(url)
        return
      }
      for (const url of Object.values(previewUrlsRef.current)) URL.revokeObjectURL(url)
      previewUrlsRef.current = nextUrls
      setPreviewUrls(nextUrls)
      setWorkstationItems(local)
      if (authEnabled) {
        try {
          const response = await listTasks({ capability: Capability.EmailAssist, page: 1 })
          if (isActive()) setEmailItems(response.items)
        } catch {
          if (isActive()) setEmailItems([])
        }
      } else {
        if (isActive()) setEmailItems([])
      }
    } finally {
      if (isActive()) setLoading(false)
    }
  }, [ownerId])

  useEffect(() => {
    let active = true
    const isActive = () => active && isCurrentWorkstationHistoryOwner(ownerId)
    queueMicrotask(() => {
      if (!isActive()) return
      void refresh(isActive)
      if (authEnabled) {
        void hydrateWorkstationHistoryFromImageJobs(ownerId)
          .then(() => isActive() ? refresh(isActive, false) : undefined)
          .catch(() => undefined)
          .finally(() => { if (isActive()) setHydrating(false) })
      }
    })
    return () => {
      active = false
      for (const url of Object.values(previewUrlsRef.current)) URL.revokeObjectURL(url)
      previewUrlsRef.current = {}
    }
  }, [ownerId, refresh])

  const items = useMemo<LibraryItem[]>(() => {
    const workstation = workstationItems.map((record) => ({
      id: record.id,
      kind: 'workstation' as const,
      title: workstationToolLabel(record.toolSlug),
      subtitle: `${record.width}×${record.height}${record.prompt ? ` · ${record.prompt}` : ''}`,
      status: 'succeeded',
      createdAt: record.createdAt,
      previewUrl: previewUrls[record.id],
      prompt: record.prompt,
      record,
    }))
    const emails = emailItems.map((item) => ({
      id: item.id,
      kind: 'email' as const,
      title: `邮件助手 · ${emailOperationLabel(item.operation)}`,
      subtitle: item.preview || '邮件任务',
      status: item.status,
      createdAt: item.createdAt,
      email: item,
    }))
    return [...workstation, ...emails].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }, [emailItems, previewUrls, workstationItems])

  const visible = items.filter((item) => filter === 'all' || item.kind === filter)
  const previewItems: PreviewItem[] = visible.flatMap(item => item.previewUrl ? [{
    id: item.id,
    thumbSrc: item.previewUrl,
    fullSrc: item.previewUrl,
    title: item.title,
    meta: { tool: item.title, resolution: item.record ? `${item.record.width}×${item.record.height}` : undefined, createdAt: item.createdAt },
  }] : [])
  const { openAt, galleryProps } = usePreviewGallery(previewItems)

  const downloadRecord = async (record: WorkstationHistoryRecord) => {
    setDownloadingId(record.id)
    try {
      await downloadImageSource(record.result, filenameForWorkstationResult({
        toolLabel: capabilityLabel(record.capability, record.toolSlug),
        width: record.width,
        height: record.height,
        mimeType: record.mimeType,
      }))
    } catch (error) {
      message.error({ content: downloadFailureMessage(error), duration: 4 })
    } finally {
      setDownloadingId(undefined)
    }
  }

  const removeRecord = async (id: string) => {
    try {
      if (!isCurrentWorkstationHistoryOwner(ownerId)) return
      await deleteWorkstationHistory(ownerId, id)
      if (isCurrentWorkstationHistoryOwner(ownerId)) {
        setWorkstationItems((current) => current.filter((item) => item.id !== id))
        const url = previewUrlsRef.current[id]
        if (url) URL.revokeObjectURL(url)
        const nextUrls = { ...previewUrlsRef.current }
        delete nextUrls[id]
        previewUrlsRef.current = nextUrls
        setPreviewUrls(nextUrls)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  return (
    <div className="assets-page">
      <div className="assets-page-header">
        <h2>我的资产</h2>
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as Filter)}
          options={[
            { label: '全部', value: 'all' },
            { label: '图片工作站', value: 'workstation' },
            { label: '邮件助手', value: 'email' },
          ]}
        />
      </div>
      {loading ? (
        <div className="assets-loading"><Spin /> 正在读取历史任务…</div>
      ) : hydrating && visible.length === 0 && filter !== 'email' ? (
        <div className="assets-loading"><Spin /> 正在补记当前账号的云端图片任务…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          description={filter === 'email'
            ? '暂无邮件任务'
            : '暂无当前账号的历史任务。旧版未标记账号的本地记录已隔离；已完成的云端图片任务会自动补记。'}
          action={<Button type="primary" onClick={() => navigate(filter === 'email' ? '/email' : '/image-workstation/repaint')}>去生成</Button>}
        />
      ) : (
        <div className="assets-grid">
          {visible.map((item) => (
            <Card
              key={item.id}
              className="assets-card"
              cover={item.previewUrl ? <div className="assets-cover"><img src={item.previewUrl} alt={item.title} /><Button className="preview-zoom-button" type="text" size="small" icon={<ZoomInOutlined />} aria-label={`放大${item.title}`} onClick={() => openAt(item.id)} /></div> : undefined}
            >
              <div className="assets-card-title">{item.title}</div>
              <div className="assets-card-meta">{formatTime(item.createdAt)} · {taskStatusLabel(item.status)}</div>
              <div className="assets-card-subtitle">{item.subtitle}</div>
              <Space>
                {item.record ? (
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    loading={downloadingId === item.id}
                    onClick={() => void downloadRecord(item.record!)}
                  >
                    下载
                  </Button>
                ) : (
                  <Button size="small" onClick={() => navigate('/email')}>查看邮件</Button>
                )}
                {item.record ? (
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void removeRecord(item.id)}>删除</Button>
                ) : null}
              </Space>
            </Card>
          ))}
        </div>
      )}
      <PreviewGallery {...galleryProps} onDownload={item => {
        const record = workstationItems.find(candidate => candidate.id === item.id)
        if (record) return downloadRecord(record)
      }} />
    </div>
  )
}
