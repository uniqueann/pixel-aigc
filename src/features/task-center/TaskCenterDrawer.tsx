import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Image,
  Select,
  Space,
  Spin,
} from 'antd'
import { CloudError } from '@/cloud/client'
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import PreviewGallery, { type PreviewItem } from '@/components/PreviewGallery'
import VideoPlayer from '@/components/VideoPlayer'
import { readOwnedImage } from '@/services/api/ownedImages'
import { downloadOwnedVideo } from '@/services/api/ownedVideos'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { modelDisplayName } from '@shared/model-display'
import {
  taskBillingLabel,
  taskStateLabel,
  taskToolLabels,
  taskTools,
  taskIsActive,
  type TaskCenterMedia,
  type TaskCenterSummary,
  type TaskHistoryState,
  type TaskTool,
} from '@shared/task-center'
import {
  readTaskHistory,
  readTaskDetail,
  recordPresentation,
  sameTaskActor,
  taskCenterKeys,
} from './client'
import { useTaskCenter } from './context'
import { TaskStatusDot } from './TaskCenterSidebar'
import { relativeTime } from './format'
import { taskDestination } from './route'

export function TaskCenterDrawer() {
  const center = useTaskCenter()
  return center ? (
    <TaskDrawerPanel
      key={center.selected?.taskKey ?? 'history'}
      center={center}
    />
  ) : null
}
function TaskDrawerPanel({
  center,
}: {
  center: NonNullable<ReturnType<typeof useTaskCenter>>
}) {
  const { message } = App.useApp(),
    actor = center.actor
  const navigate = useNavigate()
  const [gallery, setGallery] = useState(-1),
    [readingError, setReadingError] = useState(false),
    [actionBusy, setActionBusy] = useState(false)
  const abortRef = useRef(new AbortController()),
    seen = useRef(new Set<string>())
  const selected = center.selected
  useEffect(() => () => abortRef.current.abort(), [])
  const history = useInfiniteQuery({
    queryKey: [
      ...taskCenterKeys.root(actor),
      'history',
      center.tool ?? 'all',
      center.state,
    ],
    enabled: center.open && !selected,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      readTaskHistory(
        actor,
        { tool: center.tool, state: center.state },
        pageParam,
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const detail = useQuery({
    queryKey: taskCenterKeys.detail(actor, selected?.taskKey ?? 'none'),
    enabled: center.open && !!selected,
    retry: false,
    queryFn: ({ signal }) =>
      readTaskDetail(actor, selected!.sourceKind, selected!.sourceId, signal),
    staleTime: 30000,
  })
  const value = detail.data,
    task = value?.task
  useEffect(() => {
    if (!center.open || !value) return
    const expiries = value.results.flatMap((result) =>
      result.kind !== 'text' && result.availability === 'available'
        ? [new Date(result.urlExpiresAt).getTime()]
        : [],
    )
    if (!expiries.length) return
    const timer = setTimeout(
      () => {
        if (sameTaskActor(actor)) void detail.refetch()
      },
      Math.max(1000, Math.min(...expiries) - Date.now()),
    )
    return () => clearTimeout(timer)
    // 签名到期时仅重新读取当前详情，不提交生成。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.open, value, actor])
  useEffect(() => {
    if (!center.open || !task?.outcomeVersion || !sameTaskActor(actor)) return
    const key = `${task.taskKey}:${task.outcomeVersion}`
    if (seen.current.has(key) || task.seen) return
    seen.current.add(key)
    void recordPresentation(actor, task, 'seen')
      .then(() => {
        if (sameTaskActor(actor)) center.refresh()
      })
      .catch((error) => {
        if (
          error instanceof CloudError &&
          error.status === 409 &&
          sameTaskActor(actor)
        ) {
          seen.current.delete(key)
          void detail.refetch()
          center.refresh()
        }
      })
    // 服务端版本变化后重新展示并记录，地址更新不会重新标记。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.open, task?.taskKey, task?.outcomeVersion])
  const reload = () => {
    setReadingError(false)
    if (selected) void detail.refetch()
    else void history.refetch()
    center.refresh()
  }
  const media = (value?.results.filter((result) => result.kind !== 'text') ??
    []) as TaskCenterMedia[]
  const preview: PreviewItem[] = media
    .filter((result) => result.availability === 'available')
    .map((result) => ({
      id: `${task?.taskKey}:${result.ordinal}`,
      mediaType: result.kind,
      objectKey: result.objectKey,
      thumbSrc: result.url,
      fullSrc: result.url,
      expiresAt: new Date(result.urlExpiresAt).getTime(),
      ownerId: currentWorkstationHistoryOwner(),
      retentionExpiresAt: task?.resultExpiresAt ?? undefined,
      title: `${task?.tool ? taskToolLabels[task.tool] : '任务'} ${result.ordinal + 1}`,
    }))
  const download = async (item: PreviewItem) => {
    if (!sameTaskActor(actor)) return
    try {
      const ownerId = currentWorkstationHistoryOwner()
      if (item.mediaType === 'video') {
        await downloadOwnedVideo(
          {
            objectKey: item.objectKey!,
            url: item.fullSrc,
            expiresAt: item.expiresAt,
            retentionExpiresAt: item.retentionExpiresAt,
          },
          `视频-${task?.sourceId ?? '结果'}.mp4`,
          ownerId,
          {
            signal: abortRef.current.signal,
            isCurrent: () => sameTaskActor(actor),
          },
        )
        return
      }
      const blob = await readOwnedImage(
        {
          objectKey: item.objectKey!,
          url: item.fullSrc,
          expiresAt: item.expiresAt,
        },
        { ownerId, signal: abortRef.current.signal },
      )
      if (!sameTaskActor(actor)) return
      const url = URL.createObjectURL(blob),
        a = document.createElement('a')
      a.href = url
      a.download = `${task?.tool ? taskToolLabels[task.tool] : '生成结果'}-${item.id.split(':').slice(-1)[0]}.${blob.type === 'image/jpeg' ? 'jpg' : 'png'}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      if (sameTaskActor(actor)) {
        setReadingError(true)
        message.error('结果读取失败，请重新读取已有结果')
      }
    }
  }
  const dismiss = async (target: TaskCenterSummary) => {
    setActionBusy(true)
    try {
      await recordPresentation(actor, target, 'dismiss')
      if (sameTaskActor(actor)) {
        center.refresh()
        void history.refetch()
        center.show(undefined, center.tool)
      }
    } catch {
      if (sameTaskActor(actor)) {
        message.info('任务结果已变化，请重新查看')
        reload()
      }
    } finally {
      if (sameTaskActor(actor)) setActionBusy(false)
    }
  }
  return (
    <>
      <Drawer
        title={selected ? '任务详情' : '近期任务'}
        open={center.open}
        width="min(560px, 100vw)"
        onClose={() => {
          setGallery(-1)
          center.close()
        }}
        className="task-center-drawer"
        destroyOnClose
      >
        <div className="task-drawer-toolbar">
          <Space>
            {selected ? (
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => {
                  setGallery(-1)
                  center.show(undefined, center.tool)
                }}
              >
                返回列表
              </Button>
            ) : null}
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
          </Space>
          <span>展示近 30 天内的任务记录</span>
        </div>
        {!selected ? (
          <>
            <div className="task-history-filters">
              <Select
                aria-label="任务工具筛选"
                value={center.tool ?? 'all'}
                onChange={(tool) =>
                  center.filter(
                    tool === 'all' ? undefined : (tool as TaskTool),
                    center.state,
                  )
                }
                options={[
                  { value: 'all', label: '全部工具' },
                  ...taskTools.map((tool) => ({
                    value: tool,
                    label: taskToolLabels[tool],
                  })),
                ]}
              />
              <Select
                aria-label="任务状态筛选"
                value={center.state}
                onChange={(state: TaskHistoryState) =>
                  center.filter(center.tool, state)
                }
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'active', label: '进行中' },
                  { value: 'succeeded', label: '已完成' },
                  { value: 'failed', label: '失败/超时' },
                ]}
              />
            </div>
            {center.receipts
              .filter((r) => !center.tool || r.origin?.tool === center.tool)
              .map((receipt) => (
                <div
                  className="task-pending-row"
                  key={`${receipt.sourceKind}:${receipt.requestId}`}
                >
                  <span className="task-status-dot is-gray" />
                  <div>
                    <strong>任务确认中</strong>
                    <p>正在同步任务状态，请稍候...</p>
                    <small>操作编号 {receipt.requestId}</small>
                  </div>
                  <Button size="small" onClick={() => center.forget(receipt)}>
                    忽略此提示
                  </Button>
                </div>
              ))}
            {history.isPending ? <Spin /> : null}
            {history.error ? (
              <Alert
                type="warning"
                showIcon
                message="无法获取最新状态，已显示上次记录"
                action={
                  <Button size="small" onClick={reload}>
                    重试
                  </Button>
                }
              />
            ) : null}
            {history.data?.pages
              .flatMap((page) => page.items)
              .map((row) => (
                <button
                  type="button"
                  key={row.taskKey}
                  className="task-history-row"
                  onClick={() => center.show(row, center.tool)}
                >
                  <TaskStatusDot task={row} />
                  <span>
                    <strong>
                      {row.tool ? taskToolLabels[row.tool] : '生成任务'}
                    </strong>
                    <span>
                      {taskStateLabel(row)} · {row.completedCount}/
                      {row.requestedCount} · {relativeTime(row.createdAt)}
                    </span>
                    <small>
                      {taskBillingLabel(row)}
                      {row.dismissed ? ' · 已移出列表' : ''}
                    </small>
                  </span>
                </button>
              ))}
            {!history.isPending &&
            !history.error &&
            !history.data?.pages.some((page) => page.items.length) &&
            !center.receipts.length ? (
              <Empty description="暂无近期任务" />
            ) : null}
            {history.hasNextPage ? (
              <Button
                block
                loading={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                加载更多
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {detail.isPending ? <Spin /> : null}
            {detail.error ? (
              <Alert
                type="warning"
                showIcon
                message="任务详情加载失败，请稍后重试"
                action={
                  <Button size="small" onClick={reload}>
                    重新读取
                  </Button>
                }
              />
            ) : null}
            {task ? (
              <>
                <div className="task-detail-heading">
                  <TaskStatusDot task={task} />
                  <h3>
                    {task.tool ? taskToolLabels[task.tool] : '生成任务'} ·{' '}
                    {taskStateLabel(task)}
                  </h3>
                </div>
                {taskDestination(task) ? <Button onClick={() => { navigate(taskDestination(task)!); center.close() }}>在工具中查看</Button> : <p>该任务不支持跳转至原页面，可在下方查看生成结果。</p>}
                <Descriptions
                  size="small"
                  column={1}
                  items={[
                    {
                      key: 'count',
                      label: '完成数量',
                      children: `${task.completedCount}/${task.requestedCount}`,
                    },
                    {
                      key: 'model',
                      label: '模型',
                      children: modelDisplayName(task.modelProfileId),
                    },
                    {
                      key: 'billing',
                      label: '积分',
                      children: taskBillingLabel(task),
                    },
                    {
                      key: 'created',
                      label: '提交时间',
                      children: new Date(task.createdAt).toLocaleString(),
                    },
                    ...(task.resultExpiresAt
                      ? [
                          {
                            key: 'expires',
                            label: '结果有效期',
                            children: new Date(
                              task.resultExpiresAt,
                            ).toLocaleString(),
                          },
                        ]
                      : []),
                  ]}
                />
                {task.partial ? (
                  <Alert
                    type="info"
                    showIcon
                    message={`部分生成成功（${task.completedCount}/${task.requestedCount} 张），仅按实际成功张数扣费`}
                  />
                ) : null}
                {value?.errorMessage && task.state !== 'succeeded' ? (
                  <Alert type="warning" showIcon message={value.errorMessage} />
                ) : null}
                {task.warnings.includes('LATE_RESULT_NO_CHARGE') ? (
                  <Alert type="info" message="已同步最新生成结果，不额外扣费" />
                ) : null}
                {task.resultAvailability === 'expired' ||
                task.resultAvailability === 'unavailable' ? (
                  <Alert
                    type="info"
                    showIcon
                    message={
                      task.resultAvailability === 'expired'
                        ? '生成文件已过期（扣费记录不受影响）'
                        : '生成结果暂不可用或已失效'
                    }
                  />
                ) : null}
                {readingError ? (
                  <Alert
                    type="warning"
                    message="结果读取失败，请重新读取已有结果"
                    action={<Button onClick={reload}>重新读取</Button>}
                  />
                ) : null}
                <div className="task-result-list">
                  {preview.map((item, index) => (
                    <div key={item.id} className="task-result-card">
                      {item.mediaType === 'video' ? (
                        <VideoPlayer
                          reference={{
                            objectKey: item.objectKey,
                            url: item.fullSrc,
                            expiresAt: item.expiresAt,
                            retentionExpiresAt: item.retentionExpiresAt,
                          }}
                          ownerId={item.ownerId}
                        />
                      ) : (
                        <Image
                          width="100%"
                          src={item.thumbSrc}
                          alt={`生成结果 ${index + 1}`}
                          preview={false}
                          onClick={() => setGallery(index)}
                          onError={() => setReadingError(true)}
                        />
                      )}
                      <Button
                        icon={<DownloadOutlined />}
                        onClick={() => void download(item)}
                      >
                        下载结果
                      </Button>
                    </div>
                  ))}
                </div>
                {value?.results.map((result, index) =>
                  result.kind === 'text' ? (
                    <div key={index} className="task-text-result">
                      <h4>生成结果</h4>
                      <pre>{result.text}</pre>
                      <Button
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(result.text)
                            .then(() => message.success('已复制'))
                            .catch(() =>
                              message.error('复制失败，请手动选择文本'),
                            )
                        }
                      >
                        复制结果
                      </Button>
                      {result.editedText ? (
                        <>
                          <h4>修改草稿</h4>
                          <pre>{result.editedText}</pre>
                          <Button
                            onClick={() =>
                              void navigator.clipboard
                                .writeText(result.editedText!)
                                .then(() => message.success('已复制'))
                                .catch(() =>
                                  message.error('复制失败，请手动选择文本'),
                                )
                            }
                          >
                            复制修改稿
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null,
                )}
                <Space wrap>
                  <Button onClick={center.credits}>查看积分明细</Button>
                  {!taskIsActive(task) && task.outcomeVersion ? (
                    <Button
                      loading={actionBusy}
                      onClick={() => void dismiss(task)}
                    >
                      移出列表
                    </Button>
                  ) : null}
                </Space>
              </>
            ) : null}
          </>
        )}
      </Drawer>
      <PreviewGallery
        items={preview}
        open={center.open && gallery >= 0}
        current={Math.max(0, gallery)}
        onClose={() => setGallery(-1)}
        onChange={setGallery}
        onDownload={download}
      />
    </>
  )
}
