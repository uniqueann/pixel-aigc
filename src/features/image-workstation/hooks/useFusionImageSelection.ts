import { useCallback, useEffect, useRef, useState } from 'react'
import { createImageAsset } from '@/editor/services/assetService'
import type { ImageAsset } from '@/editor/types'
import { currentWorkstationHistoryOwner, isCurrentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { uploadImage } from '@/services/api/upload'
import { useUserStore } from '@/store/useUserStore'
import { fusionAbortError, type FusionInputRole } from '../fusionInputs'
import { fusionSceneAsset, readFusionScene, readFusionSceneMeta, rememberFusionScene, type FusionSceneMeta } from '../fusionSceneMemory'

/** 载入本地文件时也按账号、槽位和选择版本隔离迟到结果。 */
export function useFusionImageSelection(tool: string) {
  const userId = useUserStore(state => state.userId)
  /** 未开启登录时归属固定为 anonymous，不能只依赖 userId 判断是否可读取。 */
  const ownerId = (() => {
    try { return currentWorkstationHistoryOwner() } catch { return undefined }
  })()
  const [selection, setSelection] = useState<{ ownerId?: string; product?: ImageAsset; reference?: ImageAsset }>({})
  const [loading, setLoading] = useState({ product: false, reference: false })
  /** 单张载入失败的就地提示，按槽位隔离，避免只能靠全局 toast 猜测是哪张图。 */
  const [errors, setErrors] = useState<{ product?: string; reference?: string }>({})
  /** 最近一次用过的场景图；只存元数据，点「使用上次场景」时才读取整张图。 */
  const [lastScene, setLastScene] = useState<FusionSceneMeta>()
  const [reusingLastScene, setReusingLastScene] = useState(false)
  const versions = useRef({ product: 0, reference: 0 })
  const files = useRef<Partial<Record<FusionInputRole, File>>>({})
  const ownedUrls = useRef<string[]>([])
  /** 串行写入，避免连续上传时先发起的旧场景晚到覆盖新场景。 */
  const sceneWrites = useRef<Promise<void>>(Promise.resolve())
  const rememberScene = useCallback((ownerId: string, scene: { blob: Blob; name: string; width: number; height: number; mimeType: string }) => {
    sceneWrites.current = sceneWrites.current.then(() => rememberFusionScene(ownerId, scene)).catch(() => {})
  }, [])
  const active = useRef(true)
  const toolRef = useRef(tool)
  useEffect(() => {
    active.current = true
    const versionState = versions.current
    return () => {
      active.current = false
      versionState.product++; versionState.reference++
      for (const url of ownedUrls.current) URL.revokeObjectURL(url)
      ownedUrls.current = []
    }
  }, [])
  useEffect(() => {
    versions.current.product++; versions.current.reference++
    files.current = {}
    let current = true
    queueMicrotask(() => {
      if (!current) return
      setSelection({})
      setLoading({ product: false, reference: false })
      setErrors({})
      setLastScene(undefined)
    })
    return () => { current = false }
  }, [userId])
  useEffect(() => {
    toolRef.current = tool
    if (tool === 'fusion') return
    versions.current.product++; versions.current.reference++
    let current = true
    queueMicrotask(() => {
      if (!current) return
      setLoading({ product: false, reference: false })
      setErrors({})
    })
    return () => { current = false }
  }, [tool])
  useEffect(() => {
    if (tool !== 'fusion' || !ownerId) return
    let current = true
    void readFusionSceneMeta(ownerId).then(meta => { if (current) setLastScene(meta) }).catch(() => {})
    return () => { current = false }
  }, [tool, ownerId])
  const load = useCallback(async (role: FusionInputRole, file: File) => {
    const ownerId = currentWorkstationHistoryOwner()
    const version = ++versions.current[role]
    const current = () => active.current && toolRef.current === 'fusion' && versions.current[role] === version && isCurrentWorkstationHistoryOwner(ownerId)
    if (!current()) throw fusionAbortError()
    setLoading(previous => ({ ...previous, [role]: true }))
    setErrors(previous => ({ ...previous, [role]: undefined }))
    try {
      const uploaded = await uploadImage(file)
      if (!current()) throw fusionAbortError()
      const asset = createImageAsset({ ...uploaded, source: 'upload' })
      files.current[role] = file
      setSelection(previous => ({ ...(previous.ownerId === ownerId ? previous : {}), ownerId, [role]: asset }))
      if (role === 'reference') {
        const meta = { name: asset.name, width: asset.width, height: asset.height, mimeType: asset.mimeType }
        setLastScene({ ...meta, savedAt: new Date().toISOString() })
        rememberScene(ownerId, { ...meta, blob: file })
      }
      return asset
    } catch (error) {
      if (!current()) throw fusionAbortError()
      setErrors(previous => ({ ...previous, [role]: error instanceof Error ? error.message : '图片上传失败' }))
      throw error
    } finally { if (current()) setLoading(previous => ({ ...previous, [role]: false })) }
  }, [rememberScene])
  const visible = selection.ownerId && isCurrentWorkstationHistoryOwner(selection.ownerId)
  const adopt = (product: ImageAsset, reference?: ImageAsset) => {
    versions.current.product++; versions.current.reference++
    files.current = {}
    setSelection({ ownerId: currentWorkstationHistoryOwner(), product, reference })
    setLoading({ product:false, reference:false })
    setErrors({})
  }
  /** 两张图都就绪时交换角色，纠正上传顺序；进行中的载入会被取消。 */
  const swap = () => {
    versions.current.product++; versions.current.reference++
    setLoading({ product: false, reference: false })
    setErrors({})
    if (!selection.product || !selection.reference) return
    // 交换后场景槽位的内容变成原商品图，同步记住，供下次直接复用。
    const nextReference = selection.product
    const nextReferenceFile = files.current.product
    files.current.product = files.current.reference
    files.current.reference = nextReferenceFile
    setSelection(previous => previous.product && previous.reference
      ? { ...previous, product: previous.reference, reference: previous.product }
      : previous)
    if (nextReferenceFile && selection.ownerId && isCurrentWorkstationHistoryOwner(selection.ownerId)) {
      const meta = { name: nextReference.name, width: nextReference.width, height: nextReference.height, mimeType: nextReference.mimeType }
      setLastScene({ ...meta, savedAt: new Date().toISOString() })
      rememberScene(selection.ownerId, { ...meta, blob: nextReferenceFile })
    }
  }
  /** 移除单个槽位；另一张图和账号归属保持不变。 */
  const clear = (role: FusionInputRole) => {
    versions.current[role]++
    delete files.current[role]
    setLoading(previous => ({ ...previous, [role]: false }))
    setErrors(previous => ({ ...previous, [role]: undefined }))
    setSelection(previous => ({ ...previous, [role]: undefined }))
  }
  /** 读取上次场景并放进场景槽位；读取失败或账号已切换时返回 undefined。 */
  const reuseLastScene = useCallback(async () => {
    const ownerId = currentWorkstationHistoryOwner()
    if (!ownerId || toolRef.current !== 'fusion') return undefined
    setReusingLastScene(true)
    try {
      const scene = await readFusionScene(ownerId)
      if (!scene || toolRef.current !== 'fusion' || !isCurrentWorkstationHistoryOwner(ownerId)) return undefined
      const asset = fusionSceneAsset(scene)
      ownedUrls.current.push(asset.url)
      files.current.reference = new File([scene.blob], scene.name, { type: scene.mimeType })
      versions.current.reference++
      setLoading(previous => ({ ...previous, reference: false }))
      setSelection(previous => ({ ...(previous.ownerId === ownerId ? previous : {}), ownerId, reference: asset }))
      return asset
    } catch {
      return undefined
    } finally {
      setReusingLastScene(false)
    }
  }, [])
  return {
    product: visible ? selection.product : undefined,
    reference: visible ? selection.reference : undefined,
    loading,
    errors,
    lastScene,
    reusingLastScene,
    load,
    adopt,
    swap,
    clear,
    reuseLastScene,
  }
}
