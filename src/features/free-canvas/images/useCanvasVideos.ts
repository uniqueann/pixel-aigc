import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { readOwnedVideoUrl } from '@/services/api/ownedVideos'
import { useUserStore } from '@/store/useUserStore'
import type { Asset, Scene } from '@/editor/types'

export function useCanvasVideos(assets: Record<string, Asset>, scene?: Scene) {
  useUserStore(state => state.userId)
  const ownerId = currentWorkstationHistoryOwner()
  const projectId = useEditorStore(state => state.project?.id)
  const epoch = usePersistenceStore(state => state.epoch)
  const scope = JSON.stringify([ownerId, projectId, epoch])
  const targets = JSON.stringify((scene?.nodes ?? []).flatMap(node => {
    const asset = node.type === 'video' ? assets[node.assetId] : undefined
    return asset?.type === 'video' && (asset.objectKey ?? asset.storage?.objectKey)
      ? [{ id: asset.id, objectKey: asset.objectKey ?? asset.storage!.objectKey, retentionExpiresAt: asset.retentionExpiresAt }] : []
  }))
  const [state, setState] = useState<{ scope: string; checkedAt: number; urls: Record<string, { url: string; expiresAt?: number }>; error?: string }>({ scope: '', checkedAt: 0, urls: {} })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const references = JSON.parse(targets) as Array<{ id: string; objectKey: string; retentionExpiresAt?: string }>
    void Promise.allSettled(references.map(async reference => ({ id: reference.id,
      ...await readOwnedVideoUrl(reference, { ownerId, signal: controller.signal }) })))
      .then(results => {
        if (controller.signal.aborted) return
        const urls: Record<string, { url: string; expiresAt?: number }> = {}
        const errors: string[] = []
        results.forEach(result => {
          if (result.status === 'fulfilled') urls[result.value.id] = result.value
          else errors.push(result.reason instanceof Error ? result.reason.message : '视频读取失败')
        })
        setState({ scope, checkedAt: Date.now(), urls, error: errors.length ? [...new Set(errors)].join('；') : undefined })
        if (Object.keys(urls).length) {
          const next = Math.min(...Object.values(urls).map(signed => signed.expiresAt ?? Infinity),
            ...references.map(reference => reference.retentionExpiresAt ? new Date(reference.retentionExpiresAt).getTime() : Infinity))
          // 在签名或保留期即将结束时续签，全部过期后停止自动请求。
          timer = setTimeout(() => setAttempt(value => value + 1), Math.max(1000, Math.min(14 * 60_000, next - Date.now() - 1000)))
        }
      })
    return () => { controller.abort(); clearTimeout(timer) }
  }, [targets, ownerId, scope, attempt])
  const rendered = useMemo(() => Object.fromEntries(Object.entries(assets).map(([id, asset]) => {
    if (asset.type !== 'video' || !(asset.objectKey ?? asset.storage?.objectKey)) return [id, asset]
    const signed = state.scope === scope ? state.urls[id] : undefined
    const expired = asset.retentionExpiresAt && new Date(asset.retentionExpiresAt).getTime() <= state.checkedAt
    return [id, { ...asset, url: expired ? '/__aigc_asset__/expired' : signed?.url ?? '/__aigc_asset__/pending', missing: !!expired || !signed, accessExpiresAt: signed?.expiresAt }]
  })) as Record<string, Asset>, [assets, scope, state])
  return { assets: rendered, error: state.scope === scope ? state.error : undefined, reload: () => setAttempt(value => value + 1) }
}
