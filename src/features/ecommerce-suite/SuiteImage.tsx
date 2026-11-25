import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { i18n } from '@/i18n'
import type { SuiteAssetRef } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import { readSuiteBlob } from './backup'
import { formatSuiteError } from './i18n'
import { assignSuiteImageSource, loadSuiteImageAccess, type SuiteImageVariant } from './imageAccess'

export default function SuiteImage({ asset, client, offline = false, alt, variant = 'original' }: {
  asset?: SuiteAssetRef; client: SuiteClient; offline?: boolean; alt: string; variant?: SuiteImageVariant
}) {
  const { t } = useTranslation('ecommerce')
  const element = useRef<HTMLImageElement>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [retry, setRetry] = useState(0)
  const assetId = asset?.assetId
  const projectId = asset?.projectId
  const userId = asset?.actor.userId
  const runtimeScope = asset?.actor.runtimeScope
  useEffect(() => {
    if (!assetId || !projectId || !userId || !runtimeScope) return
    const id = assetId
    const project = projectId
    const actor = { userId, runtimeScope }
    const img = element.current
    if (!img) return
    let disposed = false
    let objectUrl: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelAssign: () => void = () => undefined
    const schedule = (delay: number) => { clearTimeout(timer); timer = setTimeout(() => { void refresh() }, delay) }
    const keepShown = () => { if (img.getAttribute('src')) schedule(30_000); else return false; return true }
    const apply = (url: string) => {
      cancelAssign()
      cancelAssign = assignSuiteImageSource(img, url, () => { if (!disposed && !keepShown()) setError(i18n.t('ecommerce:images.readFailed')) })
    }
    async function refresh() {
      try {
        client.assertCurrent()
        if (offline) {
          const blob = await readSuiteBlob(actor, project, id)
          if (!blob) throw new Error(i18n.t('ecommerce:images.notBackedUp'))
          if (disposed) return
          if (objectUrl) URL.revokeObjectURL(objectUrl)
          objectUrl = URL.createObjectURL(blob)
          apply(objectUrl)
        } else {
          const access = await loadSuiteImageAccess(client, project, id, variant)
          if (disposed) return
          apply(access.url)
          schedule(Math.max(1000, access.expiresAt - Date.now() - 30_000))
        }
        if (!disposed) setError('')
      } catch (cause) {
        if (disposed) return
        if (!keepShown()) setError(formatSuiteError(cause, 'ecommerce:images.unavailable'))
      }
    }
    void refresh()
    return () => { disposed = true; clearTimeout(timer); cancelAssign(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [assetId, projectId, userId, runtimeScope, offline, retry, variant, client])
  if (!asset) return <div className="suite-image-empty">{t('images.emptyPlaceholder')}</div>
  return <><img ref={element} alt={alt} hidden={Boolean(error) || !ready} onLoad={() => setReady(true)} onError={() => setError(t('images.readFailed'))} />
    {error && <div className="suite-image-empty"><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)}>{t('images.retryAccess')}</button></div>}</>
}
