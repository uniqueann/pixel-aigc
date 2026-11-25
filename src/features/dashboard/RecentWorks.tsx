import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PictureOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { Button, Skeleton } from 'antd'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import PreviewGallery, { type PreviewItem } from '@/components/PreviewGallery'
import { usePreviewGallery } from '@/components/usePreviewGallery'
import { useBlobUrls } from '@/components/useBlobUrls'
import { authEnabled } from '@/cloud/client'
import { hydrateWorkstationHistoryFromImageJobs } from '@/features/assets/hydrateImageJobs'
import { hydrateVideoJobs } from '@/features/assets/hydrateVideoJobs'
import { HISTORY_CHANGED, listHistoryPreviews, type WorkstationHistoryListItem } from '@/features/assets/workstationHistory'
import { isCurrentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { dashboardTime, getQuickStartGroups } from './catalog'
import { worksStripFades } from './worksStrip'
import NewUserCard from './NewUserCard'
import { acknowledgeWelcome } from '@/features/activation/client'
import { useUserStore } from '@/store/useUserStore'

function workLabel(record: WorkstationHistoryListItem, t: ReturnType<typeof useTranslation<readonly ['dashboard', 'common']>>['t']) {
  const slug = record.toolSlug.replace(/_/g, '-')
  const entries = getQuickStartGroups().flatMap(group => group.entries)
  return entries.find(entry => entry.href.endsWith(`/${slug}`))?.label ?? (record.video ? t('dashboard:recentWorks.videoWork') : t('dashboard:recentWorks.imageWork'))
}

export default function RecentWorks({ ownerId }: { ownerId: string }) {
  const { t } = useTranslation(['dashboard', 'common'])
  const [items, setItems] = useState<WorkstationHistoryListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hydrating, setHydrating] = useState(authEnabled)
  const [error, setError] = useState<string>()
  const [hydrateError, setHydrateError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const account = useUserStore.getState().account
    if (items.length && account?.userId === ownerId && account.welcome && !account.welcome.starterCardDismissed)
      acknowledgeWelcome(ownerId, { starterCardDismissed: true })
  }, [items.length, ownerId])
  useEffect(() => {
    let active = true, version = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let expiryTimer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()
    const refresh = async () => {
      const requestVersion = ++version
      try {
        const result = await listHistoryPreviews(ownerId, true, { limit: 8, readOnly: true })
        if (!active || version !== requestVersion || !isCurrentWorkstationHistoryOwner(ownerId)) return
        setItems(result); setError(undefined)
        clearTimeout(expiryTimer)
        const expiry = Math.min(...result.flatMap(item => item.video ? [Date.parse(item.video.retentionExpiresAt)] : []))
        if (Number.isFinite(expiry)) expiryTimer = setTimeout(() => void refresh(), Math.min(2147483647, Math.max(1, expiry - Date.now() + 20)))
      } catch (reason) {
        if (active && version === requestVersion) setError(reason instanceof Error ? reason.message : t('dashboard:recentWorks.readFailed'))
      } finally { if (active && version === requestVersion) setLoading(false) }
    }
    const hydrate = async () => {
      if (!authEnabled) { if (active) setHydrating(false); return }
      if (active) setHydrating(true)
      try {
        const [imageResult] = await Promise.all([
          hydrateWorkstationHistoryFromImageJobs(ownerId, { signal: abort.signal }),
          hydrateVideoJobs(ownerId, abort.signal),
        ])
        if (!active || !isCurrentWorkstationHistoryOwner(ownerId)) return
        setHydrateError(imageResult.failed ? t('dashboard:recentWorks.partialSyncFailed', { count: imageResult.failed }) : undefined)
        await refresh()
      } catch (reason) {
        if (!active || !isCurrentWorkstationHistoryOwner(ownerId)) return
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setHydrateError(t('dashboard:recentWorks.cloudSyncFailed'))
      } finally { if (active) setHydrating(false) }
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 100) }
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === ownerId) schedule() }
    queueMicrotask(() => { if (active) void refresh().finally(() => { if (active) void hydrate() }) })
    window.addEventListener(HISTORY_CHANGED, changed)
    window.addEventListener('focus', schedule)
    const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(HISTORY_CHANGED)
    if (channel) channel.onmessage = event => { if (event.data === ownerId) schedule() }
    return () => {
      active = false; abort.abort(); clearTimeout(timer); clearTimeout(expiryTimer); channel?.close()
      window.removeEventListener(HISTORY_CHANGED, changed); window.removeEventListener('focus', schedule)
    }
  }, [ownerId, attempt, t])
  const thumbnails = useMemo(() => items.map(item => item.thumbnail), [items])
  const urls = useBlobUrls(thumbnails)
  const previews = useMemo<PreviewItem[]>(() => items.map(item => {
    const label = workLabel(item, t)
    return {
      id: item.id, mediaType: item.mediaType, thumbSrc: item.thumbnail ? urls.get(item.thumbnail) ?? '' : '', fullSrc: '',
      historyId: item.id, objectKey: item.video?.objectKey ?? item.objectKey, ownerId,
      retentionExpiresAt: item.video?.retentionExpiresAt, posterKey: item.video?.posterKey, title: label,
      meta: { tool: label, resolution: `${item.width}×${item.height}`, createdAt: item.createdAt },
    }
  }), [items, ownerId, urls, t])
  const { openAt, galleryProps } = usePreviewGallery(previews)
  const stripRef = useRef<HTMLDivElement>(null)
  const [fades, setFades] = useState({ left: false, right: false })
  useLayoutEffect(() => {
    const el = stripRef.current
    if (!el) return
    let frame = 0
    const apply = () => {
      const next = worksStripFades({ scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth })
      setFades(prev => prev.left === next.left && prev.right === next.right ? prev : next)
    }
    // 吸附可能在事件之后才停稳，下一帧再读一次。起点的 scrollLeft 不一定是 0。
    const update = () => {
      apply()
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(apply)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    el.addEventListener('scrollend', update)
    el.addEventListener('load', update, true)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : undefined
    observer?.observe(el)
    for (const child of el.children) observer?.observe(child)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', update)
      el.removeEventListener('scrollend', update)
      el.removeEventListener('load', update, true)
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [items.length, loading])
  return <section className="dashboard-section" aria-labelledby="dashboard-works-title">
    <div className="dashboard-section-heading"><h2 id="dashboard-works-title">{t('dashboard:recentWorks.title')}</h2><Link to="/assets">{t('common:actions.viewAll')}</Link></div>
    {hydrating ? <p className="dashboard-section-note">{t('dashboard:recentWorks.syncing')}</p> : null}
    {error || hydrateError ? <div className="dashboard-inline-error" role="alert">{error ?? hydrateError}<Button size="small" onClick={() => setAttempt(value => value + 1)}>{t('common:actions.retryLoad')}</Button></div> : null}
    {loading || (hydrating && !items.length) ? <Skeleton active title={false} paragraph={{ rows: 2 }} /> : items.length ? <div className={`dashboard-works-scroller${fades.left ? ' has-left-fade' : ''}${fades.right ? ' has-right-fade' : ''}`}>
      <div className="dashboard-works-strip" ref={stripRef} aria-label={t('dashboard:recentWorks.listAria')}>
      {items.map(item => {
        const label = workLabel(item, t)
        const time = dashboardTime(item.createdAt)
        return <button className="dashboard-work-tile" type="button" key={item.id} onClick={() => openAt(item.id)}
          aria-label={item.video ? t('dashboard:recentWorks.playAria', { label, time }) : t('dashboard:recentWorks.previewAria', { label, time })}>
          <span className="dashboard-work-cover">
            {item.thumbnail && urls.get(item.thumbnail) ? <img src={urls.get(item.thumbnail)} alt="" loading="lazy" /> : item.video ? <PlayCircleOutlined /> : <PictureOutlined />}
            {item.video ? <span className="dashboard-video-duration">{t('dashboard:recentWorks.durationSeconds', { seconds: item.video.durationSeconds })}</span> : null}
          </span><strong>{label}</strong><time dateTime={item.createdAt}>{time}</time>
        </button>
      })}
      </div>
    </div> : !error && !hydrateError ? <NewUserCard key={ownerId} ownerId={ownerId} /> : null}
    <PreviewGallery {...galleryProps} />
  </section>
}
