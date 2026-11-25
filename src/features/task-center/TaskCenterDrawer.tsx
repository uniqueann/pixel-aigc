import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Image,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
} from 'antd'
import { CloudError } from '@/cloud/client'
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CopyOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import PreviewGallery, { type PreviewItem } from '@/components/PreviewGallery'
import VideoPlayer from '@/components/VideoPlayer'
import { formatDateTime } from '@/i18n/format'
import { readOwnedImage } from '@/services/api/ownedImages'
import { downloadOwnedVideo } from '@/services/api/ownedVideos'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import {
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
import {
  formatTaskErrorMessage,
  localizedModelDisplayName,
  localizedTaskBillingLabel,
  localizedTaskStateLabel,
  relativeTime,
  taskToolLabel,
} from './format'
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
  const { t } = useTranslation('taskCenter')
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
      title: `${taskToolLabel(task?.tool, 'short')} ${result.ordinal + 1}`,
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
          t('drawer.videoFilename', {
            id: task?.sourceId ?? t('drawer.videoFilenameFallback'),
          }),
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
      a.download = `${taskToolLabel(task?.tool, 'result')}-${item.id.split(':').slice(-1)[0]}.${blob.type === 'image/jpeg' ? 'jpg' : 'png'}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      if (sameTaskActor(actor)) {
        setReadingError(true)
        message.error(t('drawer.readResultFailed'))
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
        message.info(t('drawer.resultChangedReload'))
        reload()
      }
    } finally {
      if (sameTaskActor(actor)) setActionBusy(false)
    }
  }
  const detailError = task
    ? formatTaskErrorMessage(task, value?.errorMessage)
    : null
  return (
    <>
      <Drawer
        title={selected ? t('drawer.detailTitle') : t('drawer.recentTitle')}
        open={center.open}
        width="min(560px, 100vw)"
        onClose={() => {
          setGallery(-1)
          center.close()
        }}
        className="task-center-drawer"
        destroyOnClose
        footer={
          selected && task ? (
            <div className="task-drawer-footer">
              <Space wrap>
                <Button onClick={center.credits}>{t('drawer.viewCredits')}</Button>
                {!taskIsActive(task) && task.outcomeVersion ? (
                  <Button
                    loading={actionBusy}
                    onClick={() => void dismiss(task)}
                  >
                    {t('drawer.dismiss')}
                  </Button>
                ) : null}
              </Space>
              <div>
                {taskDestination(task) ? (
                  <Button
                    type="primary"
                    icon={<ArrowRightOutlined aria-hidden="true" />}
                    aria-label={t('drawer.openInTool')}
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent('pixel-sidebar-collapse'),
                      )
                      navigate(taskDestination(task)!)
                      center.close()
                    }}
                  >
                    {t('drawer.openInTool')}
                  </Button>
                ) : (
                  <Tooltip title={t('drawer.cannotOpenInToolTooltip')}>
                    <Button disabled aria-label={t('drawer.openInTool')}>
                      {t('drawer.openInTool')}
                    </Button>
                  </Tooltip>
                )}
              </div>
            </div>
          ) : null
        }
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
                {t('drawer.backToList')}
              </Button>
            ) : null}
            <Button icon={<ReloadOutlined />} onClick={reload}>
              {t('actions.refresh')}
            </Button>
          </Space>
          <span>
            {selected
              ? task
                ? t('drawer.submittedAtRelative', {
                    time: relativeTime(task.createdAt),
                  })
                : ''
              : t('drawer.recentWindowNotice')}
          </span>
        </div>
        {!selected ? (
          <>
            <div className="task-history-filters">
              <Select
                aria-label={t('drawer.filterToolAria')}
                value={center.tool ?? 'all'}
                onChange={(tool) =>
                  center.filter(
                    tool === 'all' ? undefined : (tool as TaskTool),
                    center.state,
                  )
                }
                options={[
                  { value: 'all', label: t('drawer.allTools') },
                  ...taskTools.map((tool) => ({
                    value: tool,
                    label: taskToolLabel(tool),
                  })),
                ]}
              />
              <Select
                aria-label={t('drawer.filterStateAria')}
                value={center.state}
                onChange={(state: TaskHistoryState) =>
                  center.filter(center.tool, state)
                }
                options={[
                  { value: 'all', label: t('drawer.stateAll') },
                  { value: 'active', label: t('drawer.stateActive') },
                  { value: 'succeeded', label: t('drawer.stateSucceeded') },
                  { value: 'failed', label: t('drawer.stateFailed') },
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
                    <strong>{t('pending.title')}</strong>
                    <p>{t('pending.description')}</p>
                    <small>{t('pending.requestId', { id: receipt.requestId })}</small>
                  </div>
                  <Button size="small" onClick={() => center.forget(receipt)}>
                    {t('pending.dismiss')}
                  </Button>
                </div>
              ))}
            {history.isPending ? <Spin /> : null}
            {history.error ? (
              <Alert
                type="warning"
                showIcon
                message={t('drawer.historyLoadWarning')}
                action={
                  <Button size="small" onClick={reload}>
                    {t('actions.retry')}
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
                    <strong>{taskToolLabel(row.tool)}</strong>
                    <span>
                      {localizedTaskStateLabel(row)} · {row.completedCount}/
                      {row.requestedCount} · {relativeTime(row.createdAt)}
                    </span>
                    <small>
                      {localizedTaskBillingLabel(row)}
                      {row.dismissed ? t('drawer.dismissedSuffix') : ''}
                    </small>
                  </span>
                </button>
              ))}
            {!history.isPending &&
            !history.error &&
            !history.data?.pages.some((page) => page.items.length) &&
            !center.receipts.length ? (
              <Empty description={t('empty')} />
            ) : null}
            {history.hasNextPage ? (
              <Button
                block
                loading={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {t('actions.loadMore')}
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
                message={t('drawer.detailLoadFailed')}
                action={
                  <Button size="small" onClick={reload}>
                    {t('actions.reload')}
                  </Button>
                }
              />
            ) : null}
            {task ? (
              <>
                <div className="task-detail-heading">
                  <div className="task-detail-heading-main">
                    <TaskStatusDot task={task} />
                    <h3 className="task-detail-title">
                      {taskToolLabel(task.tool)}
                    </h3>
                    <Tag className={`task-state-tag is-${task.state}`}>
                      {localizedTaskStateLabel(task)}
                    </Tag>
                  </div>
                  <span className="task-detail-time">
                    {relativeTime(task.createdAt)}
                  </span>
                </div>

                {task.partial ? (
                  <Alert
                    type="info"
                    showIcon
                    message={
                      task.sourceKind === 'suite_batch'
                        ? t('drawer.partialSuiteBatch', {
                            completed: task.completedCount,
                            requested: task.requestedCount,
                          })
                        : t('drawer.partialImages', {
                            completed: task.completedCount,
                            requested: task.requestedCount,
                          })
                    }
                  />
                ) : null}
                {value?.children && <div className="task-detail-section">
                  <div className="task-detail-section-title">{t('drawer.suiteChildrenTitle')}</div>
                  <p>{t('drawer.suiteChildrenDesc')}</p>
                  {value.children.map(child => <Button key={child.taskKey} block onClick={() => center.show(child)}>
                    {t('drawer.suiteChildItem', {
                      state: localizedTaskStateLabel(child),
                      completed: child.completedCount,
                      requested: child.requestedCount,
                      billing: localizedTaskBillingLabel(child),
                    })}
                  </Button>)}
                </div>}
                {detailError && task.state !== 'succeeded' ? (
                  <Alert type="warning" showIcon message={detailError} />
                ) : null}
                {task.warnings.includes('LATE_RESULT_NO_CHARGE') ? (
                  <Alert type="info" message={t('detail.lateResultNoCharge')} />
                ) : null}
                {task.resultAvailability === 'expired' ||
                task.resultAvailability === 'unavailable' ? (
                  <Alert
                    type="info"
                    showIcon
                    message={
                      task.resultAvailability === 'expired'
                        ? t('detail.resultExpired')
                        : t('detail.resultUnavailable')
                    }
                  />
                ) : null}
                {readingError ? (
                  <Alert
                    type="warning"
                    message={t('drawer.readResultFailed')}
                    action={<Button onClick={reload}>{t('actions.reload')}</Button>}
                  />
                ) : null}

                {preview.length > 0 ? (
                  <div className="task-detail-section">
                    <div className="task-detail-section-title">
                      <span>{t('detail.mediaTitle')}</span>
                      <span className="task-detail-count">
                        {t('detail.mediaCount', { count: preview.length })}
                      </span>
                    </div>
                    <div
                      className={`task-result-list${preview.length === 1 ? ' is-single' : ''}`}
                    >
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
                              alt={t('detail.mediaAlt', { index: index + 1 })}
                              preview={false}
                              onClick={() => setGallery(index)}
                              onError={() => setReadingError(true)}
                            />
                          )}
                          <Button
                            icon={<DownloadOutlined />}
                            onClick={() => void download(item)}
                          >
                            {t('detail.downloadResult')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {value?.results.some((r) => r.kind === 'text') ? (
                  <div className="task-detail-section">
                    <div className="task-detail-section-title">
                      <span>{t('detail.textTitle')}</span>
                    </div>
                    {value?.results.map((result, index) =>
                      result.kind === 'text' ? (
                        <div key={index} className="task-text-result-card">
                          <div className="task-text-result-block">
                            <div className="task-text-result-header">
                              <h4>{t('detail.textResultHeading')}</h4>
                              <Button
                                size="small"
                                icon={<CopyOutlined aria-hidden="true" />}
                                aria-label={t('actions.copyResult')}
                                onClick={() =>
                                  void navigator.clipboard
                                    .writeText(result.text)
                                    .then(() => message.success(t('detail.copied')))
                                    .catch(() =>
                                      message.error(t('detail.copyFailed')),
                                    )
                                }
                              >
                                {t('actions.copyResult')}
                              </Button>
                            </div>
                            <pre>{result.text}</pre>
                          </div>
                          {result.editedText ? (
                            <div className="task-text-result-block">
                              <div className="task-text-result-header">
                                <h4>{t('detail.editedDraftHeading')}</h4>
                                <Button
                                  size="small"
                                  icon={<CopyOutlined aria-hidden="true" />}
                                  aria-label={t('actions.copyEdited')}
                                  onClick={() =>
                                    void navigator.clipboard
                                      .writeText(result.editedText!)
                                      .then(() => message.success(t('detail.copied')))
                                      .catch(() =>
                                        message.error(t('detail.copyFailed')),
                                      )
                                  }
                                >
                                  {t('actions.copyEdited')}
                                </Button>
                              </div>
                              <pre>{result.editedText}</pre>
                            </div>
                          ) : null}
                        </div>
                      ) : null,
                    )}
                  </div>
                ) : null}

                {taskIsActive(task) &&
                !preview.length &&
                !value?.results.length ? (
                  <div className="task-detail-active-banner">
                    <Spin size="small" />
                    <span>{t('detail.processingBanner')}</span>
                  </div>
                ) : null}

                <div className="task-detail-section">
                  <div className="task-detail-section-title">
                    <span>{t('detail.infoTitle')}</span>
                  </div>
                  <div className="task-detail-meta-grid">
                    <div className="task-meta-item">
                      <span className="task-meta-label">{t('detail.modelLabel')}</span>
                      <span className="task-meta-value">
                        {localizedModelDisplayName(task.modelProfileId)}
                      </span>
                    </div>
                    <div className="task-meta-item">
                      <span className="task-meta-label">{t('detail.completedCountLabel')}</span>
                      <span className="task-meta-value">
                        {task.completedCount}/{task.requestedCount}
                      </span>
                    </div>
                    <div className="task-meta-item">
                      <span className="task-meta-label">{t('detail.billingLabel')}</span>
                      <span className="task-meta-value">
                        {localizedTaskBillingLabel(task)}
                      </span>
                    </div>
                    <div className="task-meta-item">
                      <span className="task-meta-label">{t('detail.createdAtLabel')}</span>
                      <span className="task-meta-value">
                        {formatDateTime(task.createdAt)}
                      </span>
                    </div>
                    {task.resultExpiresAt ? (
                      <div className="task-meta-item">
                        <span className="task-meta-label">{t('detail.expiresAtLabel')}</span>
                        <span className="task-meta-value">
                          {formatDateTime(task.resultExpiresAt)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  {!taskDestination(task) ? (
                    <p className="task-detail-notice">
                      {t('detail.cannotReopenNotice')}
                    </p>
                  ) : null}
                </div>
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
