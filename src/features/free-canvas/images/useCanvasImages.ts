import { useEffect, useMemo, useRef, useState } from 'react'
import { bindRuntimeImage, releaseRuntimeImageUser, setRuntimeImageUsers, withRuntimeImage } from '@/editor/runtimeImages'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { currentWorkstationHistoryOwner, isCurrentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { readOwnedImage, invalidateOwnedImage } from '@/services/api/ownedImages'
import { runtimeImageBlob } from '@/services/api/imageRuntime'
import { readResultImage } from '@/features/image-workstation/imageMetadata'
import type { Asset, Scene } from '@/editor/types'
import { useUserStore } from '@/store/useUserStore'

/** 运行时读取私有媒体，不把 Blob 地址或过期签名写进项目存档。 */
export function useCanvasImages(assets: Record<string, Asset>, scene: Scene | undefined, sourceAssetId?: string, previewAssetIds: string[] = []) {
  useUserStore(state => state.userId)
  const ownerId = currentWorkstationHistoryOwner()
  const projectId = useEditorStore((state) => state.project?.id)
  const epoch = usePersistenceStore((state) => state.epoch)
  const user = useRef({})
  const [version, setVersion] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [errors, setErrors] = useState<Record<string, { scope: string; message: string }>>({})
  const scope = JSON.stringify([ownerId, projectId, epoch])
  const targets = JSON.stringify([...new Set([...(scene?.nodes.flatMap(node => node.type === 'image' ? [node.assetId] : []) ?? []), ...(sourceAssetId ? [sourceAssetId] : []), ...previewAssetIds])].sort())
  useEffect(() => {
    const runtimeUser = user.current
    return () => { releaseRuntimeImageUser(runtimeUser) }
  }, [ownerId, projectId])
  useEffect(() => {
    const controller = new AbortController()
    const ids = JSON.parse(targets) as string[]
    setRuntimeImageUsers(user.current, ids)
    const current = () => !controller.signal.aborted && isCurrentWorkstationHistoryOwner(ownerId) && useEditorStore.getState().project?.id === projectId && usePersistenceStore.getState().epoch === epoch
    for (const id of ids) {
      const asset = assets[id]
      if (asset?.type !== 'image' || !(asset.objectKey ?? asset.storage?.objectKey) || runtimeImageBlob(withRuntimeImage(asset, ownerId).url)) continue
      const objectKey = asset.objectKey ?? asset.storage!.objectKey
      void readOwnedImage({ objectKey, url: asset.url.startsWith('/__aigc_asset__/') ? undefined : asset.url, expiresAt: asset.accessExpiresAt }, { ownerId, signal: controller.signal })
        .then(readResultImage)
        .then(result => {
          if (!current()) return
          bindRuntimeImage(ownerId, asset, result.blob, user.current)
          setRuntimeImageUsers(user.current, ids)
          setErrors(previous => { const next = { ...previous }; delete next[id]; return next })
          setVersion(value => value + 1)
        }).catch(error => {
          if (current()) {
            invalidateOwnedImage(ownerId, objectKey)
            setErrors(previous => ({ ...previous, [id]: { scope, message: `“${asset.name}”读取失败：${error instanceof Error ? error.message : '请重试读取'}` } }))
          }
        })
    }
    return () => controller.abort()
  }, [assets, targets, ownerId, projectId, epoch, attempt, scope])
  const renderAssets = useMemo(() => {
    void version
    return Object.fromEntries(Object.entries(assets).map(([id, asset]) => {
      if (asset.type !== 'image' || !(asset.objectKey ?? asset.storage?.objectKey)) return [id, asset]
      const runtime = withRuntimeImage(asset, ownerId)
      return [id, { ...runtime, missing: !runtimeImageBlob(runtime.url) }]
    })) as Record<string, Asset>
  }, [assets, version, ownerId])
  const visibleIds = new Set(JSON.parse(targets) as string[])
  const error = Object.entries(errors).filter(([id, entry]) => visibleIds.has(id) && entry.scope === scope).map(([, entry]) => entry.message).join('；') || undefined
  return { assets: renderAssets, error, reload: () => { setAttempt(value => value + 1) } }
}
