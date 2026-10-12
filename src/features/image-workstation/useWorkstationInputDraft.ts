import { useCallback, useEffect, useRef } from 'react'
import { createImageAsset } from '@/editor/services/assetService'
import { bindRuntimeImage, releaseRuntimeImageUser, setRuntimeImageUsers, withRuntimeImage } from '@/editor/runtimeImages'
import type { ImageAsset } from '@/editor/types'
import { sameTaskActor } from '@/features/task-center/client'
import { readOwnedImage } from '@/services/api/ownedImages'
import { useUserStore } from '@/store/useUserStore'
import { readResultImage } from './imageMetadata'
import { clearInputDraft, readInputDraft, readLiveSession } from './liveSession'

/** 刷新后恢复「将结果作为新输入」的图片。返回的函数使进行中的恢复失效。 */
export function useWorkstationInputDraft(tool: string, fusion: boolean, restore: (asset: ImageAsset) => void) {
  const owner = useUserStore(state => state.account?.userId === state.userId ? state.userId : undefined)
  const scope = useUserStore(state => state.account?.runtimeScope)
  const epoch = useRef(0)
  const runtime = useRef({})
  const restoreRef = useRef(restore)
  useEffect(() => { restoreRef.current = restore }, [restore])
  useEffect(() => { const user = runtime.current; return () => releaseRuntimeImageUser(user) }, [])
  const invalidate = useCallback(() => { epoch.current += 1 }, [])
  useEffect(() => {
    if (!owner || !scope || fusion) return
    const actor = { owner, scope } as const
    const draft = readInputDraft(actor, tool)
    // 进行中的任务自己会带回结果；这时再套用旧输入会盖住刚恢复的成图。
    if (!draft || readLiveSession(actor, tool)) return
    const seen = epoch.current
    let cancelled = false
    const signal = new AbortController()
    void (async () => {
      try {
        const blob = await readOwnedImage({ objectKey: draft.objectKey, mimeType: draft.mimeType }, { ownerId: owner, signal: signal.signal })
        const measured = await readResultImage(blob)
        if (cancelled || seen !== epoch.current || !sameTaskActor(actor)) return
        const asset = createImageAsset({ id: `asset:input:${draft.objectKey}`, name: draft.name, url: '', objectKey: draft.objectKey, width: measured.width, height: measured.height, mimeType: measured.mimeType, source: 'generation' })
        bindRuntimeImage(owner, asset, measured.blob, runtime.current)
        setRuntimeImageUsers(runtime.current, [asset.id])
        restoreRef.current(withRuntimeImage(asset, owner))
      } catch {
        if (!cancelled && seen === epoch.current) clearInputDraft(actor, tool)
      }
    })()
    return () => { cancelled = true; signal.abort() }
  }, [fusion, owner, scope, tool])
  return invalidate
}
