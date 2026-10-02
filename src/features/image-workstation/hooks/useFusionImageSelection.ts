import { useCallback, useEffect, useRef, useState } from 'react'
import { createImageAsset } from '@/editor/services/assetService'
import type { ImageAsset } from '@/editor/types'
import { currentWorkstationHistoryOwner, isCurrentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { uploadImage } from '@/services/api/upload'
import { useUserStore } from '@/store/useUserStore'
import { fusionAbortError, type FusionInputRole } from '../fusionInputs'

/** 载入本地文件时也按账号、槽位和选择版本隔离迟到结果。 */
export function useFusionImageSelection(tool: string) {
  const userId = useUserStore(state => state.userId)
  const [selection, setSelection] = useState<{ ownerId?: string; product?: ImageAsset; reference?: ImageAsset }>({})
  const [loading, setLoading] = useState({ product: false, reference: false })
  const versions = useRef({ product: 0, reference: 0 })
  const active = useRef(true)
  const toolRef = useRef(tool)
  useEffect(() => {
    active.current = true
    const versionState = versions.current
    return () => { active.current = false; versionState.product++; versionState.reference++ }
  }, [])
  useEffect(() => {
    versions.current.product++; versions.current.reference++
    let current = true
    queueMicrotask(() => { if (current) { setSelection({}); setLoading({ product: false, reference: false }) } })
    return () => { current = false }
  }, [userId])
  useEffect(() => {
    toolRef.current = tool
    if (tool === 'fusion') return
    versions.current.product++; versions.current.reference++
    let current = true
    queueMicrotask(() => { if (current) setLoading({ product: false, reference: false }) })
    return () => { current = false }
  }, [tool])
  const load = useCallback(async (role: FusionInputRole, file: File) => {
    const ownerId = currentWorkstationHistoryOwner()
    const version = ++versions.current[role]
    const current = () => active.current && toolRef.current === 'fusion' && versions.current[role] === version && isCurrentWorkstationHistoryOwner(ownerId)
    if (!current()) throw fusionAbortError()
    setLoading(previous => ({ ...previous, [role]: true }))
    try {
      const uploaded = await uploadImage(file)
      if (!current()) throw fusionAbortError()
      const asset = createImageAsset({ ...uploaded, source: 'upload' })
      setSelection(previous => ({ ...(previous.ownerId === ownerId ? previous : {}), ownerId, [role]: asset }))
      return asset
    } catch (error) {
      if (!current()) throw fusionAbortError()
      throw error
    } finally { if (current()) setLoading(previous => ({ ...previous, [role]: false })) }
  }, [])
  const visible = selection.ownerId && isCurrentWorkstationHistoryOwner(selection.ownerId)
  return { product: visible ? selection.product : undefined, reference: visible ? selection.reference : undefined, loading, load }
}
