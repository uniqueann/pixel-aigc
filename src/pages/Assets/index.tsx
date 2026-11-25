import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AppstoreOutlined, CheckOutlined, DownloadOutlined, DeleteOutlined, MailOutlined, MoreOutlined, PictureOutlined, SearchOutlined, UnorderedListOutlined,
} from '@ant-design/icons'
import { App, Alert, Button, Dropdown, Input, Segmented, Select, Space, Spin, Tooltip, type InputRef } from 'antd'
import CoverPlaceholder from '@/components/CoverPlaceholder'
import EmptyState from '@/components/EmptyState'
import PreviewGallery, { type PreviewItem } from '@/components/PreviewGallery'
import VideoPoster from '@/components/VideoPoster'
import { downloadOwnedVideo } from '@/services/api/ownedVideos'
import { usePreviewGallery } from '@/components/usePreviewGallery'
import { authEnabled } from '@/cloud/client'
import {
  capabilityLabel,
  emailOperationLabel,
  taskStatusLabel,
  workstationToolLabel,
} from '@/features/assets/labels'
import { hydrateWorkstationHistoryFromImageJobs } from '@/features/assets/hydrateImageJobs'
import { hydrateVideoJobs } from '@/features/assets/hydrateVideoJobs'
import { isCurrentWorkstationHistoryOwner, resolveWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import {
  deleteWorkstationHistory,
  listHistoryPreviews,
  restoreWorkstationHistory,
  HISTORY_CHANGED,
  type WorkstationHistoryListItem,
} from '@/features/assets/workstationHistory'
import { downloadFailureMessage, downloadImageSource, filenameForWorkstationResult } from '@/features/image-workstation/download'
import { i18n } from '@/i18n'
import { translateApiError } from '@/i18n/apiErrors'
import { activeLocale, formatShortDateTime } from '@/i18n/format'
import type { Locale } from '@/i18n/types'
import { runtimeImageBlob } from '@/services/api/imageRuntime'
import { readOwnedImage } from '@/services/api/ownedImages'
import { listTasks, type TaskSummary } from '@/services/api/task'
import { Capability } from '@/types'
import { modelDisplayName } from '@shared/model-display'
import { useUserStore } from '@/store/useUserStore'
import { usePreferencesStore } from '@/features/preferences/store'
import { useCapabilities } from '@/hooks/useCapabilities'
import { capabilityAvailability } from '@/components/capabilityAvailability'
import VideoAvailabilityNotice from '@/features/free-canvas/generation/VideoAvailabilityNotice'
import { groupAssetsByDay } from './groupByDay'

type Filter = 'all' | 'workstation' | 'video' | 'email'
type ViewMode = 'grid' | 'list'
type SortOrder = 'newest' | 'oldest'
/** 批量删除的 toast 用一个固定 key，撤销后手动关闭。 */
const BATCH_DELETE_KEY = 'asset-deleted-batch'
const UNKNOWN_MODEL_DISPLAY = modelDisplayName('__unknown__')
const NA_MODEL_DISPLAY = modelDisplayName(null)

function initialViewMode(): ViewMode {
  const { workbench, recent } = usePreferencesStore.getState().preferences
  return workbench.assetsView === 'remember' ? recent.assetsView : workbench.assetsView
}
function initialSort(): SortOrder {
  return usePreferencesStore.getState().preferences.recent.assetsSort ?? 'newest'
}

/** 搜索文本：整段提示词参与匹配（展示标题会被截断），统一全角与大小写。 */
function normalizeSearchText(locale: Locale, ...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase(locale)
}

function formatAssetsError(error: unknown, fallback: string) {
  const apiErr = error as { code?: string; extra?: Record<string, unknown>; status?: number } | undefined
  return translateApiError({
    code: apiErr?.code,
    extra: apiErr?.extra,
    status: apiErr?.status,
    message: error instanceof Error ? error.message : undefined,
    fallback,
  })
}

function historyLoadError(error: unknown) {
  const apiErr = error as { code?: string; status?: number } | undefined
  if (apiErr?.code || typeof apiErr?.status === 'number') {
    return formatAssetsError(error, i18n.t('assets:errors.loadFailed'))
  }
  return i18n.t('assets:errors.loadFailed')
}

function localizeDownloadError(error: unknown) {
  if (activeLocale() === 'zh-CN') return downloadFailureMessage(error)
  const raw = error instanceof Error ? error.message.trim() : ''
  if (!raw || /failed to fetch|networkerror|load failed|err_failed/i.test(raw)) {
    return i18n.t('assets:errors.downloadFailed')
  }
  return formatAssetsError(error, i18n.t('assets:errors.downloadFailed'))
}

interface LibraryItem {
  id: string
  kind: 'workstation' | 'video' | 'email'
  title: string
  subtitle: string
  status: string
  createdAt: string
  searchText: string
  previewUrl?: string
  prompt?: string
  record?: WorkstationHistoryListItem
  email?: TaskSummary
}

/** 用提示词首句指代作品，避免多条同名工具记录无法区分；邮件任务退回预览首句。 */
function assetDisplayName(item: LibraryItem) {
  const source = item.record?.prompt?.trim() || item.email?.preview?.trim()
  if (!source) return item.title
  return source.length > 20 ? `${source.slice(0, 20)}…` : source
}

export default function Assets() {
  const { t } = useTranslation('assets')
  const userId = useUserStore((state) => state.userId)
  let ownerId: string
  try {
    ownerId = resolveWorkstationHistoryOwner(authEnabled, userId)
  } catch {
    return <EmptyState description={t('empty.signInRequired')} />
  }
  return <AssetsForOwner key={ownerId} ownerId={ownerId} />
}

function AssetsForOwner({ ownerId }: { ownerId: string }) {
  const navigate = useNavigate()
  const { t, i18n: i18nInstance } = useTranslation(['assets', 'common'])
  const locale = activeLocale(i18nInstance.language === 'en-US' ? 'en-US' : 'zh-CN')
  const { message, modal } = App.useApp()
  const { capabilities, error: capabilityError, refetch: reloadCapabilities } = useCapabilities()
  const videoEnabled = capabilities.textToVideo === true || capabilities.imageToVideo === true
    ? true : capabilities.textToVideo === false && capabilities.imageToVideo === false ? false : undefined
  const videoState = capabilityAvailability(videoEnabled, capabilityError)
  const [filter, setFilter] = useState<Filter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode)
  const [sort, setSort] = useState<SortOrder>(initialSort)
  const [query, setQuery] = useState('')
  /** 参与过滤的查询：中文输入法拼写阶段不更新，避免作品墙在拼音未上屏时闪成空。 */
  const [submittedQuery, setSubmittedQuery] = useState('')
  const composingRef = useRef(false)
  const searchRef = useRef<InputRef>(null)
  const deferredQuery = useDeferredValue(submittedQuery)
  const [loading, setLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string>()
  const lifetimeAbortRef = useRef(new AbortController())
  const [hydrating, setHydrating] = useState(authEnabled)
  const [workstationItems, setWorkstationItems] = useState<WorkstationHistoryListItem[]>([])
  const [emailItems, setEmailItems] = useState<TaskSummary[]>([])
  /** 邮件任务服务端分页：固定每页 20 条，total 由接口返回。 */
  const [emailPage, setEmailPage] = useState(1)
  const [emailTotal, setEmailTotal] = useState(0)
  const [loadingMoreEmails, setLoadingMoreEmails] = useState(false)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const previewVersionsRef = useRef<Record<string, string>>({})
  const previewUrlsRef = useRef<Record<string, string>>({})
  const refreshVersionRef = useRef(0)
  const [downloadingId, setDownloadingId] = useState<string>()
  const [announcement, setAnnouncement] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)
  /** 删除后把焦点交给同一位置的下一张作品，避免焦点落回 body。 */
  const focusAfterDeleteRef = useRef<number | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  /** 当前打开的卡片菜单：rc-dropdown 不会给触发器加 aria-expanded，这里自己受控。 */
  const [openMenuId, setOpenMenuId] = useState<string>()
  const selectToggleRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null)
  /** 退出选择模式后把焦点还给「选择」按钮（只在主动退出时）。 */
  const restoreSelectFocusRef = useRef(false)

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    usePreferencesStore.getState().update({ recent: { assetsView: mode } })
  }

  const changeSort = (value: SortOrder) => {
    setSort(value)
    usePreferencesStore.getState().update({ recent: { assetsSort: value } })
  }

  const changeQuery = (value: string) => {
    setQuery(value)
    if (!composingRef.current) setSubmittedQuery(value)
  }

  const clearSearch = () => {
    setQuery('')
    setSubmittedQuery('')
    searchRef.current?.focus()
  }

  const refresh = useCallback(async (isActive: () => boolean, showLoading = true) => {
    const version = ++refreshVersionRef.current
    const current = () => isActive() && version === refreshVersionRef.current
    if (showLoading) setLoading(true)
    try {
      if (!current()) return
      const local = await listHistoryPreviews(ownerId, true)
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
          if (isActive()) {
            setEmailItems(response.items)
            setEmailPage(1)
            setEmailTotal(response.total)
          }
        } catch {
          if (isActive()) {
            setEmailItems([])
            setEmailPage(1)
            setEmailTotal(0)
          }
        }
      } else if (!authEnabled) {
        if (current()) {
          setEmailItems([])
          setEmailPage(1)
          setEmailTotal(0)
        }
      }
    } finally {
      if (current()) setLoading(false)
    }
  }, [ownerId])

  /** 追加下一页邮件任务；按 id 去重，避免接口重叠或重复点击产生重复卡片。 */
  const loadMoreEmails = useCallback(async () => {
    if (loadingMoreEmails) return
    const version = refreshVersionRef.current
    setLoadingMoreEmails(true)
    try {
      const nextPage = emailPage + 1
      const response = await listTasks({ capability: Capability.EmailAssist, page: nextPage })
      // 期间发生了刷新或切换账号，本次结果已过期，直接丢弃。
      if (version !== refreshVersionRef.current) return
      setEmailItems(previous => [
        ...previous,
        ...response.items.filter(item => !previous.some(existing => existing.id === item.id)),
      ])
      setEmailTotal(response.total)
      setEmailPage(nextPage)
    } catch (error) {
      const text = formatAssetsError(error, i18n.t('assets:errors.emailLoadFailed'))
      message.error(text)
      setAnnouncement(text)
    } finally {
      setLoadingMoreEmails(false)
    }
  }, [emailPage, loadingMoreEmails, message])

  useEffect(() => {
    let active = true
    const abort = new AbortController()
    lifetimeAbortRef.current = abort
    const isActive = () => active && isCurrentWorkstationHistoryOwner(ownerId)
    queueMicrotask(() => {
      if (!isActive()) return
      void refresh(isActive).catch((error: unknown) => { if (isActive()) setHistoryError(historyLoadError(error)) })
      if (authEnabled) {
        void Promise.all([hydrateWorkstationHistoryFromImageJobs(ownerId, { signal: abort.signal }), hydrateVideoJobs(ownerId, abort.signal)])
          .then(([result]) => {
            if (!isActive()) return
            if (result.failed) setHistoryError(i18n.t('assets:errors.partialLoadFailed', { count: result.failed }))
            return refresh(isActive, false)
          })
          .catch((error: unknown) => { if (isActive()) setHistoryError(historyLoadError(error)) })
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
        const [result] = await Promise.all([hydrateWorkstationHistoryFromImageJobs(ownerId, { signal: lifetimeAbortRef.current.signal }), hydrateVideoJobs(ownerId, lifetimeAbortRef.current.signal)])
        if (isActive() && result.failed) setHistoryError(i18n.t('assets:errors.partialLoadFailed', { count: result.failed }))
        if (isActive()) await refresh(isActive, false)
      }
    } catch (error) { if (isActive()) setHistoryError(historyLoadError(error)) }
    finally { if (isActive()) setHydrating(false) }
  }

  const items = useMemo<LibraryItem[]>(() => {
    const workstation = workstationItems.map((record) => {
      const rawModel = record.modelProfileId ? modelDisplayName(record.modelProfileId) : undefined
      const videoModelLabel = rawModel && rawModel !== UNKNOWN_MODEL_DISPLAY && rawModel !== NA_MODEL_DISPLAY
        ? rawModel
        : record.modelProfileId
          ? t('assets:video.legacyModel')
          : undefined
      const title = record.mediaType === 'video'
        ? videoModelLabel
          ? t('assets:video.modelTitle', { model: videoModelLabel })
          : t('assets:video.defaultTitle')
        : workstationToolLabel(record.toolSlug)
      const subtitle = record.video
        ? t('assets:video.subtitle', {
          duration: record.video.durationSeconds.toFixed(1),
          width: record.width,
          height: record.height,
          expiresAt: formatShortDateTime(record.video.retentionExpiresAt, locale),
        })
        : `${record.width}×${record.height}${record.prompt ? ` · ${record.prompt}` : ''}`
      return {
        id: record.id,
        kind: record.mediaType === 'video' ? 'video' as const : 'workstation' as const,
        title,
        subtitle,
        status: 'succeeded',
        createdAt: record.createdAt,
        searchText: normalizeSearchText(locale, record.prompt, title, subtitle),
        previewUrl: previewUrls[record.id],
        prompt: record.prompt,
        record,
      }
    })
    const emails = emailItems.map((item) => {
      const title = t('assets:email.title', { operation: emailOperationLabel(item.operation) })
      const subtitle = item.preview || t('assets:email.fallbackSubtitle')
      return {
        id: item.id,
        kind: 'email' as const,
        title,
        subtitle,
        status: item.status,
        createdAt: item.createdAt,
        searchText: normalizeSearchText(locale, item.preview, title, subtitle),
        email: item,
      }
    })
    return [...workstation, ...emails]
  }, [emailItems, locale, previewUrls, t, workstationItems])

  const ordered = useMemo(() => {
    const direction = sort === 'newest' ? -1 : 1
    return [...items].sort((left, right) =>
      direction * left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  }, [items, sort])

  /** 空白切成多个关键词，全部命中才算匹配（「融合 耳机」也能找到）。 */
  const searchTokens = useMemo(() => deferredQuery.trim().normalize('NFKC')
    .toLocaleLowerCase(locale).split(/\s+/).filter(Boolean), [deferredQuery, locale])

  const visible = useMemo(() => ordered.filter((item) =>
    (filter === 'all' || item.kind === filter)
    && searchTokens.every((token) => item.searchText.includes(token))), [filter, ordered, searchTokens])

  const searching = items.length > 0 && searchTokens.length > 0
  const trimmedQuery = deferredQuery.trim()
  const groups = useMemo(() => groupAssetsByDay(visible), [visible])
  /** 只有带本机历史记录的作品能批量删除，邮件任务不在批量范围内。 */
  const selectableVisible = useMemo(() => visible.filter((item) => item.record), [visible])
  const canSelect = selectableVisible.length > 0
  /** 只有邮件任务走服务端分页；选择模式下隐藏，避免批量操作期间列表长度变化。 */
  const canLoadMoreEmails = authEnabled && !selecting
    && (filter === 'all' || filter === 'email')
    && emailItems.length < emailTotal
  const allVisibleSelected = selectableVisible.length > 0
    && selectableVisible.every((item) => selectedIds.has(item.id))
  const previewItems: PreviewItem[] = visible.flatMap(item => item.record ? [{
    id: item.id,
    mediaType: item.record?.mediaType,
    retentionExpiresAt: item.record?.video?.retentionExpiresAt,
    posterKey: item.record?.video?.posterKey,
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
      if (record.video) {
        await downloadOwnedVideo(
          record.video,
          i18n.t('assets:video.downloadFilename', { seconds: record.video.durationSeconds.toFixed(1) }),
          ownerId,
        )
        return
      }
      await downloadImageSource(currentBlob ?? await readOwnedImage({ historyId: record.id, objectKey: record.objectKey }, { ownerId }), filenameForWorkstationResult({
        toolLabel: capabilityLabel(record.capability, record.toolSlug),
        width: record.width,
        height: record.height,
        mimeType: record.mimeType,
      }))
    } catch (error) {
      const text = localizeDownloadError(error)
      message.error({ content: text, duration: 4 })
      setAnnouncement(text)
    } finally {
      setDownloadingId(undefined)
    }
  }

  /** 选择模式：封面点击切换选中，不再打开画廊。 */
  const enterSelection = () => {
    setSelecting(true)
    setSelectedIds(new Set())
    // 菜单在选中封面时会卸载，清掉受控状态避免退出选择后自动弹出。
    setOpenMenuId(undefined)
    // 焦点交给第一张可选封面，键盘用户可以直接空格勾选。
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLElement>('.assets-cover:not(.assets-cover-email)')?.focus()
    })
  }

  const exitSelection = useCallback(() => {
    restoreSelectFocusRef.current = true
    setSelecting(false)
    setSelectedIds(new Set())
  }, [])

  /** 选择模式下按 Escape 退出；搜索框与确认框保留自己的 Escape 行为。 */
  useEffect(() => {
    if (!selecting) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return
      if (document.querySelector('.ant-modal-wrap')) return
      exitSelection()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [exitSelection, selecting])

  useEffect(() => {
    if (selecting || !restoreSelectFocusRef.current) return
    restoreSelectFocusRef.current = false
    selectToggleRef.current?.focus()
  }, [selecting])

  /** 只统计仍在作品列表里的选中项：刷新或删除后失效的 id 不计入。 */
  const selectedCount = useMemo(
    () => items.filter((item) => item.record && selectedIds.has(item.id)).length,
    [items, selectedIds],
  )

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 全选只作用于当前筛选/搜索结果里可选的作品。 */
  const toggleSelectAll = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) for (const item of selectableVisible) next.delete(item.id)
      else for (const item of selectableVisible) next.add(item.id)
      return next
    })
  }

  /** 本地移除作品并释放缩略图的 object URL。 */
  const applyRemoved = (ids: string[]) => {
    const removed = new Set(ids)
    setWorkstationItems((current) => current.filter((candidate) => !removed.has(candidate.id)))
    const nextUrls = { ...previewUrlsRef.current }
    for (const id of ids) {
      const url = nextUrls[id]
      if (url) URL.revokeObjectURL(url)
      delete nextUrls[id]
    }
    previewUrlsRef.current = nextUrls
    setPreviewUrls(nextUrls)
  }

  const undoBatchDelete = async (ids: string[]) => {
    message.destroy(BATCH_DELETE_KEY)
    let restored = 0
    for (const id of ids) {
      try {
        if (await restoreWorkstationHistory(ownerId, id)) restored += 1
      } catch {
        // 单条恢复失败不影响其余作品
      }
    }
    try {
      await refresh(() => isCurrentWorkstationHistoryOwner(ownerId), false)
    } catch {
      // 恢复已完成，刷新失败不改变结果提示
    }
    if (restored === ids.length) {
      const text = i18n.t('assets:undo.batchRestored', { count: restored })
      setAnnouncement(text)
      message.success(text)
    } else if (restored > 0) {
      const text = i18n.t('assets:undo.batchPartialRestored', { count: restored })
      setAnnouncement(text)
      message.warning(text)
    } else {
      const text = i18n.t('assets:undo.expired')
      setAnnouncement(text)
      message.warning(text)
    }
  }

  const removeSelected = async (targets: LibraryItem[]) => {
    const deleted: string[] = []
    for (const item of targets) {
      if (!item.record || !isCurrentWorkstationHistoryOwner(ownerId)) break
      try {
        await deleteWorkstationHistory(ownerId, item.record.id)
        deleted.push(item.id)
      } catch {
        // 单条失败继续删除其余作品，最后统一提示
      }
    }
    if (!deleted.length) {
      const text = i18n.t('assets:delete.failedRetry')
      message.error(text)
      setAnnouncement(text)
      return
    }
    if (!isCurrentWorkstationHistoryOwner(ownerId)) return
    applyRemoved(deleted)
    setSelecting(false)
    setSelectedIds(new Set())
    focusAfterDeleteRef.current = 0
    setAnnouncement(i18n.t('assets:delete.batchAnnouncement', { count: deleted.length }))
    message.open({
      key: BATCH_DELETE_KEY,
      type: 'success',
      duration: 5,
      content: (
        <span>
          {i18n.t('assets:delete.batchDone', { count: deleted.length })}
          <Button
            className="assets-undo-link"
            type="text"
            size="small"
            aria-label={i18n.t('assets:undo.batchAria', { count: deleted.length })}
            onClick={() => void undoBatchDelete(deleted)}
          >
            {i18n.t('common:actions.undo')}
          </Button>
        </span>
      ),
    })
    if (deleted.length < targets.length) {
      const text = i18n.t('assets:delete.batchPartialFailed', { count: targets.length - deleted.length })
      message.warning(text)
      setAnnouncement(text)
    }
  }

  const confirmBatchDelete = () => {
    const targets = items.filter((item) => item.record && selectedIds.has(item.id))
    if (!targets.length) return
    modal.confirm({
      className: 'assets-delete-confirm',
      title: t('assets:delete.batchConfirmTitle', { count: targets.length }),
      content: t('assets:delete.batchConfirmContent'),
      okText: t('common:actions.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common:actions.cancel'),
      onOk: () => removeSelected(targets),
    })
  }

  const undoDelete = async (id: string, name: string) => {
    message.destroy(`asset-deleted-${id}`)
    try {
      const restored = await restoreWorkstationHistory(ownerId, id)
      if (!restored) {
        const text = i18n.t('assets:undo.expired')
        message.warning(text)
        setAnnouncement(text)
        return
      }
      await refresh(() => isCurrentWorkstationHistoryOwner(ownerId), false)
      setAnnouncement(i18n.t('assets:undo.singleAnnouncement', { name }))
      message.success(i18n.t('assets:undo.singleSuccess'))
    } catch (error) {
      const text = formatAssetsError(error, i18n.t('assets:errors.restoreFailed'))
      message.error(text)
      setAnnouncement(text)
    }
  }

  const removeRecord = async (item: LibraryItem) => {
    const record = item.record
    if (!record) return
    const removedIndex = visible.findIndex((candidate) => candidate.id === item.id)
    const name = assetDisplayName(item)
    try {
      if (!isCurrentWorkstationHistoryOwner(ownerId)) return
      await deleteWorkstationHistory(ownerId, record.id)
      if (!isCurrentWorkstationHistoryOwner(ownerId)) return
      applyRemoved([record.id])
      focusAfterDeleteRef.current = removedIndex
      setAnnouncement(i18n.t('assets:delete.singleAnnouncement', { name, remaining: Math.max(0, visible.length - 1) }))
      message.open({
        key: `asset-deleted-${record.id}`,
        type: 'success',
        duration: 5,
        content: (
          <span>
            {i18n.t('assets:delete.singleDone', { name })}
            <Button
              className="assets-undo-link"
              type="text"
              size="small"
              aria-label={i18n.t('assets:undo.singleAria', { name })}
              onClick={() => void undoDelete(record.id, name)}
            >
              {i18n.t('common:actions.undo')}
            </Button>
          </span>
        ),
      })
    } catch (error) {
      const text = formatAssetsError(error, i18n.t('assets:errors.deleteFailed'))
      message.error(text)
      setAnnouncement(text)
    }
  }

  const confirmDelete = (item: LibraryItem) => {
    const name = assetDisplayName(item)
    modal.confirm({
      className: 'assets-delete-confirm',
      title: t('assets:delete.singleConfirmTitle'),
      content: t('assets:delete.singleConfirmContent', { name }),
      okText: t('common:actions.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common:actions.cancel'),
      onOk: () => removeRecord(item),
    })
  }

  useEffect(() => {
    if (focusAfterDeleteRef.current === null) return
    const index = focusAfterDeleteRef.current
    focusAfterDeleteRef.current = null
    const covers = gridRef.current?.querySelectorAll<HTMLElement>('.assets-cover')
    if (covers?.length) covers[Math.min(index, covers.length - 1)]?.focus()
    else {
      // 页签的 label 本身不可聚焦，落到内部 radio 上；空态时落到「去生成」。
      const radio = document.querySelector<HTMLElement>('.assets-page-header .ant-segmented-item-selected input')
      ;(radio ?? document.querySelector<HTMLElement>('.assets-page .ant-empty button'))?.focus()
    }
  }, [workstationItems])

  /** 普通函数而不是新组件：分组后仍按 visible 顺序铺开，避免每次渲染重建组件类型。 */
  const renderCard = (item: LibraryItem) => {
    const name = assetDisplayName(item)
    const isVideo = item.kind === 'video'
    const selectable = Boolean(item.record)
    const selected = selecting && selectable && selectedIds.has(item.id)
    const inSelection = selecting && selectable
    const coverLabel = inSelection
      ? selected
        ? t('assets:card.deselectAria', { name })
        : t('assets:card.selectAria', { name })
      : isVideo
        ? t('assets:card.playVideoAria', { name })
        : t('assets:card.viewImageAria', { name })
    return (
      <article
        key={item.id}
        className={`assets-card${viewMode === 'list' ? ' assets-card-list' : ''}${inSelection ? ' is-selectable' : ''}${selected ? ' is-selected' : ''}`}
      >
        {item.record ? (
          <button
            className="assets-cover"
            type="button"
            aria-label={coverLabel}
            aria-pressed={inSelection ? selected : undefined}
            title={
              inSelection
                ? (selected ? t('assets:selection.deselect') : t('assets:selection.select'))
                : isVideo
                  ? t('assets:card.playVideoTitle')
                  : t('assets:card.viewImageTitle')
            }
            onClick={() => (inSelection ? toggleSelect(item.id) : openAt(item.id))}
          >
            {item.record.video ? (
              <>
                <VideoPoster posterKey={item.record.video.posterKey} retentionExpiresAt={item.record.video.retentionExpiresAt} ownerId={ownerId} variant="cover" />
                <span className="assets-video-duration">{t('common:time.seconds', { count: item.record.video.durationSeconds })}</span>
              </>
            ) : item.previewUrl ? (
              <>
                <img
                  className="cover-backdrop"
                  src={item.previewUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <img className="assets-cover-image" src={item.previewUrl} alt="" loading="lazy" decoding="async" />
              </>
            ) : (
              <CoverPlaceholder icon={<PictureOutlined />} />
            )}
            {inSelection ? (
              <span className="assets-select-check" aria-hidden="true">{selected ? <CheckOutlined /> : null}</span>
            ) : null}
          </button>
        ) : (
          <button
            className={`assets-cover assets-cover-email${selecting ? ' assets-cover-unselectable' : ''}`}
            type="button"
            aria-label={t('assets:card.viewEmailAria', { name })}
            aria-disabled={selecting || undefined}
            disabled={selecting}
            title={selecting ? t('assets:card.emailBatchUnsupported') : t('assets:card.viewEmailTitle')}
            onClick={() => navigate(`/email?mode=single&taskId=${encodeURIComponent(item.email?.id ?? item.id)}`)}
          >
            <CoverPlaceholder icon={<MailOutlined />} />
          </button>
        )}
        <div className="assets-card-details">
          <div className="assets-card-title" title={item.prompt || name}>{name}</div>
          <div className="assets-card-meta" title={item.subtitle}>
            {item.title} · <time dateTime={item.createdAt}>{formatShortDateTime(item.createdAt, locale)}</time>
            {item.status === 'succeeded' ? '' : ` · ${taskStatusLabel(item.status)}`}
          </div>
          {item.record?.video ? (
            <div className="assets-card-expiry">
              {t('assets:video.expiresAt', { time: formatShortDateTime(item.record.video.retentionExpiresAt, locale) })}
            </div>
          ) : null}
        </div>
        {item.record && !selecting ? (
          <Dropdown
            trigger={['click']}
            overlayClassName="assets-card-menu"
            open={openMenuId === item.id}
            onOpenChange={(open) => setOpenMenuId(open ? item.id : undefined)}
            menu={{
              items: [
                {
                  key: 'download',
                  icon: <DownloadOutlined />,
                  label: (
                    <span>
                      {downloadingId === item.id ? t('assets:card.downloading') : t('common:actions.download')}
                      <span className="sr-only">{t('assets:card.srName', { name })}</span>
                    </span>
                  ),
                  disabled: downloadingId === item.id,
                },
                {
                  key: 'delete',
                  danger: true,
                  icon: <DeleteOutlined />,
                  label: (
                    <>
                      {t('common:actions.delete')}
                      <span className="sr-only">{t('assets:card.srName', { name })}</span>
                    </>
                  ),
                },
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation()
                if (key === 'download') void downloadRecord(item.record!)
                if (key === 'delete') confirmDelete(item)
              },
            }}
          >
            <Button
              size="small"
              className="assets-card-more"
              icon={<MoreOutlined />}
              aria-label={t('assets:card.moreAria', { name })}
              aria-haspopup="menu"
              aria-expanded={openMenuId === item.id}
            />
          </Dropdown>
        ) : null}
      </article>
    )
  }

  return (
    <div className="assets-page">
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      <h1 className="sr-only">{t('assets:title')}</h1>
      <div className="assets-page-header">
        <div className="page-tab-row">
          <Segmented
            aria-label={t('assets:filters.ariaLabel')}
            value={filter}
            onChange={(value) => setFilter(value as Filter)}
            options={[
              { label: t('assets:filters.all'), value: 'all' },
              { label: t('assets:filters.images'), value: 'workstation' },
              { label: t('assets:filters.videos'), value: 'video' },
              { label: t('assets:filters.email'), value: 'email' },
            ]}
          />
        </div>
        <Space.Compact className="assets-view-switch" role="group" aria-label={t('assets:view.groupAria')}>
          <Tooltip title={t('assets:view.list')}>
            <Button
              icon={<UnorderedListOutlined />}
              aria-label={t('assets:view.list')}
              aria-pressed={viewMode === 'list'}
              type={viewMode === 'list' ? 'primary' : 'default'}
              onClick={() => changeViewMode('list')}
            />
          </Tooltip>
          <Tooltip title={t('assets:view.grid')}>
            <Button
              icon={<AppstoreOutlined />}
              aria-label={t('assets:view.grid')}
              aria-pressed={viewMode === 'grid'}
              type={viewMode === 'grid' ? 'primary' : 'default'}
              onClick={() => changeViewMode('grid')}
            />
          </Tooltip>
        </Space.Compact>
      </div>
      {items.length > 0 ? (
        <div className="assets-filter-bar">
          <div className="assets-toolbar">
            <Input
              ref={searchRef}
              className="assets-search"
              prefix={<SearchOutlined />}
              allowClear
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={(event) => { composingRef.current = false; setSubmittedQuery(event.currentTarget.value) }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape' || !query) return
                event.preventDefault()
                clearSearch()
              }}
              placeholder={t('assets:search.placeholder')}
              aria-label={t('assets:search.ariaLabel')}
              autoComplete="off"
              enterKeyHint="search"
            />
            <Select
              className="assets-sort"
              aria-label={t('assets:sort.ariaLabel')}
              value={sort}
              onChange={(value) => changeSort(value as SortOrder)}
              options={[
                { value: 'newest', label: t('assets:sort.newest') },
                { value: 'oldest', label: t('assets:sort.oldest') },
              ]}
            />
            {canSelect && !selecting ? (
              <Button
                ref={selectToggleRef}
                type="text"
                className="assets-select-toggle"
                onClick={enterSelection}
              >
                {t('assets:selection.select')}
              </Button>
            ) : null}
          </div>
          {searching
            ? <p className="assets-search-count" role="status">{t('assets:search.resultCount', { count: visible.length })}</p>
            : null}
        </div>
      ) : null}
      {filter === 'video' && videoState !== 'ready' ? <VideoAvailabilityNotice state={videoState} onRetry={() => void reloadCapabilities()} /> : null}
      {historyError ? <Alert type="warning" showIcon message={historyError} action={<Button size="small" loading={hydrating} onClick={() => void retryHistory()}>{t('assets:actions.reload')}</Button>} /> : null}
      {loading ? (
        <div className="assets-loading" role="status"><Spin /> {t('assets:loading')}</div>
      ) : hydrating && visible.length === 0 && filter !== 'email' ? (
        <div className="assets-loading" role="status"><Spin /> {t('assets:loading')}</div>
      ) : visible.length === 0 ? (
        searching ? (
          <EmptyState
            description={t('assets:search.empty', { query: trimmedQuery.length > 24 ? `${trimmedQuery.slice(0, 24)}…` : trimmedQuery })}
            action={<Button onClick={clearSearch}>{t('assets:search.clear')}</Button>}
          />
        ) : (
          <EmptyState
            description={filter === 'email'
              ? t('assets:empty.email')
              : filter === 'video' ? t('assets:empty.video') : t('assets:empty.all')}
            action={filter === 'video' && videoState !== 'ready' ? undefined : <Button type="primary" onClick={() => navigate(filter === 'email' ? '/email' : filter === 'video' ? capabilities.textToVideo === true ? '/canvas/text-to-video' : '/canvas/text-to-image' : '/image-workstation/repaint')}>{filter === 'video' && capabilities.textToVideo !== true ? t('assets:empty.openCanvas') : t('assets:empty.goCreate')}</Button>}
          />
        )
      ) : (
        <div ref={gridRef} className="assets-groups">
          {groups.map((group) => (
            <section key={group.key} className="assets-group" aria-labelledby={`assets-group-${group.key}`}>
              <h2 id={`assets-group-${group.key}`} className="assets-group-title">{group.label}</h2>
              <div className={viewMode === 'grid' ? 'assets-grid' : 'assets-list'}>
                {group.items.map(renderCard)}
              </div>
            </section>
          ))}
        </div>
      )}
      {canLoadMoreEmails ? (
        <div className="assets-load-more">
          <Button loading={loadingMoreEmails} aria-busy={loadingMoreEmails} onClick={() => void loadMoreEmails()}>
            {t('assets:email.loadMore')}
          </Button>
          <p className="assets-load-more-hint" role="status">
            {t('assets:email.loadedHint', { loaded: emailItems.length, total: emailTotal })}
          </p>
        </div>
      ) : null}
      {selecting ? (
        <div className="assets-selection-bar" role="group" aria-label={t('assets:selection.barAria')}>
          <span className="assets-selection-count" aria-live="polite">{t('assets:selection.selectedCount', { count: selectedCount })}</span>
          <div className="assets-selection-actions">
            <Button type="text" onClick={toggleSelectAll}>{allVisibleSelected ? t('assets:selection.deselectAll') : t('assets:selection.selectAll')}</Button>
            <Button danger disabled={selectedCount === 0} onClick={confirmBatchDelete}>{t('common:actions.delete')}</Button>
            <Button type="text" onClick={exitSelection}>{t('common:actions.cancel')}</Button>
          </div>
        </div>
      ) : null}
      <PreviewGallery {...galleryProps} onDownload={item => {
        const record = workstationItems.find(candidate => candidate.id === item.id)
        if (record) return downloadRecord(record, runtimeImageBlob(item.fullSrc))
      }} />
    </div>
  )
}
