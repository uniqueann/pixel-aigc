import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { DownloadOutlined, DeleteOutlined } from '@ant-design/icons'
import { App, Button, Card, Segmented, Space, Spin } from 'antd'
import EmptyState from '@/components/EmptyState'
import { authEnabled } from '@/cloud/client'
import {
  capabilityLabel,
  emailOperationLabel,
  taskStatusLabel,
  workstationToolLabel,
} from '@/features/assets/labels'
import {
  deleteWorkstationHistory,
  listWorkstationHistory,
  type WorkstationHistoryRecord,
} from '@/features/assets/workstationHistory'
import { downloadImageSource, filenameForWorkstationResult } from '@/features/image-workstation/download'
import { listTasks, type TaskSummary } from '@/services/api/task'
import { Capability } from '@/types'

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
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [workstationItems, setWorkstationItems] = useState<WorkstationHistoryRecord[]>([])
  const [emailItems, setEmailItems] = useState<TaskSummary[]>([])
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [downloadingId, setDownloadingId] = useState<string>()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const local = await listWorkstationHistory()
      const nextUrls: Record<string, string> = {}
      for (const item of local) nextUrls[item.id] = URL.createObjectURL(item.result)
      setPreviewUrls((previous) => {
        for (const url of Object.values(previous)) URL.revokeObjectURL(url)
        return nextUrls
      })
      setWorkstationItems(local)
      if (authEnabled) {
        try {
          const response = await listTasks({ capability: Capability.EmailAssist, page: 1 })
          setEmailItems(response.items)
        } catch {
          setEmailItems([])
        }
      } else {
        setEmailItems([])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void refresh()
    })
    return () => {
      setPreviewUrls((previous) => {
        for (const url of Object.values(previous)) URL.revokeObjectURL(url)
        return {}
      })
    }
  }, [refresh])

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
      message.error(error instanceof Error ? error.message : '下载失败')
    } finally {
      setDownloadingId(undefined)
    }
  }

  const removeRecord = async (id: string) => {
    try {
      await deleteWorkstationHistory(id)
      setWorkstationItems((current) => current.filter((item) => item.id !== id))
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
      ) : visible.length === 0 ? (
        <EmptyState
          description={filter === 'email'
            ? '暂无邮件任务'
            : '暂无历史任务，去邮件助手或图片工作站生成点内容吧'}
          action={<Button type="primary" onClick={() => navigate(filter === 'email' ? '/email' : '/image-workstation/repaint')}>去生成</Button>}
        />
      ) : (
        <div className="assets-grid">
          {visible.map((item) => (
            <Card
              key={item.id}
              className="assets-card"
              cover={item.previewUrl ? (
                <img
                  src={item.previewUrl}
                  alt={item.title}
                  onError={(event: SyntheticEvent<HTMLImageElement>) => {
                    event.currentTarget.style.display = 'none'
                  }}
                />
              ) : undefined}
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
    </div>
  )
}
