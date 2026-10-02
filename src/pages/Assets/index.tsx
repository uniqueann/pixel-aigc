import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppstoreOutlined, DownloadOutlined, DeleteOutlined, MailOutlined, UnorderedListOutlined, ZoomInOutlined } from '@ant-design/icons'
import { App, Alert, Button, Card, Segmented, Space, Spin, Tooltip } from 'antd'
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
  listHistoryPreviews,
  HISTORY_CHANGED,
  type WorkstationHistoryListItem,
} from '@/features/assets/workstationHistory'
import { downloadFailureMessage, downloadImageSource, filenameForWorkstationResult } from '@/features/image-workstation/download'
import { runtimeImageBlob } from '@/services/api/imageRuntime'
import { readOwnedImage } from '@/services/api/ownedImages'
import { listTasks, type TaskSummary } from '@/services/api/task'
import { Capability } from '@/types'
import { useUserStore } from '@/store/useUserStore'
import { usePreferencesStore } from '@/features/preferences/store'

type Filter = 'all' | 'workstation' | 'email'
type ViewMode = 'grid' | 'list'
function initialViewMode(): ViewMode {
  const { workbench, recent } = usePreferencesStore.getState().preferences
  return workbench.assetsView === 'remember' ? recent.assetsView : workbench.assetsView
}

interface LibraryItem {
  id: string
  kind: 'workstation' | 'email'
  title: string
  subtitle: string
  status: string
  createdAt: string
  previewUrl?: string
  prompt?: string
  record?: WorkstationHistoryListItem
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
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode)
  const [loading, setLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string>()
  const lifetimeAbortRef = useRef(new AbortController())
  const [hydrating, setHydrating] = useState(authEnabled)
  const [workstationItems, setWorkstationItems] = useState<WorkstationHistoryListItem[]>([])
  const [emailItems, setEmailItems] = useState<TaskSummary[]>([])
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const previewVersionsRef = useRef<Record<string, string>>({})
  const previewUrlsRef = useRef<Record<string, string>>({})
  const refreshVersionRef = useRef(0)
  const [downloadingId, setDownloadingId] = useState<string>()

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    usePreferencesStore.getState().update({ recent: { assetsView: mode } })
  }

  const refresh = useCallback(async (isActive: () => boolean, showLoading = true) => {
    const version = ++refreshVersionRef.current
    const current = () => isActive() && version === refreshVersionRef.current
    if (showLoading) setLoading(true)
    try {
      if (!current()) return
      const local = await listHistoryPreviews(ownerId)
      if (!current()) return
      const nextUrls: Record<string, string> = {}
      const nextVersions: Record<string, string> = {}
      for (const item of local) if (item.thumbnail) {
        nextVersions[item.id] = item.updatedAt
        nextUrls[item.id] = previewVersionsRef.current[item.id] === item.updatedAt && previewUrlsRef.current[item.id]
          ? previewUrlsRef.current[item.id] : URL.createObjectURL(item.thumbnail)
      }
      if (!current()) {
        for (const url of Object.values(nextUrls)) if (!Object.values(previewUrlsRef.current).includes(url)) URL.revokeObjectURL(url)
        return
      }
      for (const url of Object.values(previewUrlsRef.current)) if (!Object.values(nextUrls).includes(url)) URL.revokeObjectURL(url)
      previewVersionsRef.current = nextVersions
      previewUrlsRef.current = nextUrls
      setPreviewUrls(nextUrls)
      setWorkstationItems(local)
      if (authEnabled && showLoading) {
        try {
          const response = await listTasks({ capability: Capability.EmailAssist, page: 1 })
          if (isActive()) setEmailItems(response.items)
        } catch {
          if (isActive()) setEmailItems([])
        }
      } else if (!authEnabled) {
        if (current()) setEmailItems([])
      }
    } finally {
      if (current()) setLoading(false)
    }
  }, [ownerId])

  useEffect(() => {
    let active = true
    const abort = new AbortController()
    lifetimeAbortRef.current = abort
    const isActive = () => active && isCurrentWorkstationHistoryOwner(ownerId)
    queueMicrotask(() => {
      if (!isActive()) return
      void refresh(isActive).catch(error => { if (isActive()) setHistoryError(error instanceof Error ? error.message : '历史读取失败') })
      if (authEnabled) {
        void hydrateWorkstationHistoryFromImageJobs(ownerId, { signal: abort.signal })
          .then(result => {
            if (!isActive()) return
            if (result.failed) setHistoryError(`有 ${result.failed} 项结果未能补记，请重试读取与保存`)
            return refresh(isActive, false)
          })
          .catch(error => { if (isActive()) setHistoryError(error instanceof Error ? error.message : '历史补记失败') })
          .finally(() => { if (isActive()) setHydrating(false) })
      }
    })
    const updated = () => { void refresh(isActive, false).catch(() => undefined) }
    window.addEventListener(HISTORY_CHANGED, updated)
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(HISTORY_CHANGED) : undefined
    if (channel) channel.onmessage = event => { if (event.data === ownerId) updated() }
    return () => {
      active = false
      abort.abort()
      window.removeEventListener(HISTORY_CHANGED, updated)
      channel?.close()
      for (const url of Object.values(previewUrlsRef.current)) URL.revokeObjectURL(url)
      previewUrlsRef.current = {}
    }
  }, [ownerId, refresh])

  const retryHistory = async () => {
    const isActive = () => !lifetimeAbortRef.current.signal.aborted && isCurrentWorkstationHistoryOwner(ownerId)
    setHistoryError(undefined)
    setHydrating(authEnabled)
    try {
      await refresh(isActive)
      if (authEnabled && isActive()) {
        const result = await hydrateWorkstationHistoryFromImageJobs(ownerId, { signal: lifetimeAbortRef.current.signal })
        if (isActive() && result.failed) setHistoryError(`有 ${result.failed} 项结果未能补记，请重试读取与保存`)
        if (isActive()) await refresh(isActive, false)
      }
    } catch (error) { if (isActive()) setHistoryError(error instanceof Error ? error.message : '历史读取失败') }
    finally { if (isActive()) setHydrating(false) }
  }

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
  const previewItems: PreviewItem[] = visible.flatMap(item => item.record ? [{
    id: item.id,
    thumbSrc: item.previewUrl ?? '',
    fullSrc: '',
    historyId: item.id,
    objectKey: item.record?.objectKey,
    ownerId,
    title: item.title,
    meta: { tool: item.title, resolution: item.record ? `${item.record.width}×${item.record.height}` : undefined, createdAt: item.createdAt },
  }] : [])
  const { openAt, galleryProps } = usePreviewGallery(previewItems)

  const downloadRecord = async (record: WorkstationHistoryListItem, currentBlob?: Blob) => {
    setDownloadingId(record.id)
    try {
      await downloadImageSource(currentBlob ?? await readOwnedImage({ historyId: record.id, objectKey: record.objectKey }, { ownerId }), filenameForWorkstationResult({
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
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as Filter)}
          options={[
            { label: '全部', value: 'all' },
            { label: '图片工作站', value: 'workstation' },
            { label: '邮件助手', value: 'email' },
          ]}
        />
        <Space.Compact className="assets-view-switch" role="group" aria-label="展示样式">
          <Tooltip title="列表视图">
            <Button
              icon={<UnorderedListOutlined />}
              aria-label="列表视图"
              aria-pressed={viewMode === 'list'}
              type={viewMode === 'list' ? 'primary' : 'default'}
              onClick={() => changeViewMode('list')}
            />
          </Tooltip>
          <Tooltip title="网格视图">
            <Button
              icon={<AppstoreOutlined />}
              aria-label="网格视图"
              aria-pressed={viewMode === 'grid'}
              type={viewMode === 'grid' ? 'primary' : 'default'}
              onClick={() => changeViewMode('grid')}
            />
          </Tooltip>
        </Space.Compact>
      </div>
      {historyError ? <Alert type="warning" showIcon message={historyError} action={<Button size="small" loading={hydrating} onClick={() => void retryHistory()}>重试历史读取与保存</Button>} /> : null}
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
        <div className={viewMode === 'grid' ? 'assets-grid' : 'assets-list'}>
          {visible.map((item) => {
            const preview = item.record ? (
              <button className="assets-cover" type="button" aria-label={`查看${item.title}大图`} title="查看大图" onClick={() => openAt(item.id)}>
                {item.previewUrl ? <img src={item.previewUrl} alt={item.title} /> : <span>查看原图</span>}
              </button>
            ) : null
            return (
              <Card
                key={item.id}
                className={`assets-card${viewMode === 'list' ? ' assets-card-list' : ''}`}
                cover={viewMode === 'grid' ? preview : undefined}
              >
                {viewMode === 'list' ? preview ?? <div className="assets-email-cover" aria-hidden="true"><MailOutlined /></div> : null}
                <div className="assets-card-details">
                  <div className="assets-card-title">{item.title}</div>
                  <div className="assets-card-meta">{formatTime(item.createdAt)} · {taskStatusLabel(item.status)}</div>
                  <div className="assets-card-subtitle" title={item.subtitle}>{item.subtitle}</div>
                </div>
                <Space className="assets-card-actions" wrap>
                  {item.record ? <Button size="small" icon={<ZoomInOutlined />} onClick={() => openAt(item.id)}>查看大图</Button> : null}
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
            )
          })}
        </div>
      )}
      <PreviewGallery {...galleryProps} onDownload={item => {
        const record = workstationItems.find(candidate => candidate.id === item.id)
        if (record) return downloadRecord(record, runtimeImageBlob(item.fullSrc))
      }} />
    </div>
  )
}
