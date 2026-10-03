import { useEffect, useRef, useState } from 'react'

/** URL 只在已提交的副作用中创建，避免严格模式或中断渲染遗留图片引用。 */
export function useBlobUrls(blobs: readonly (Blob | undefined)[]) {
  const owned = useRef(new Map<Blob, string>())
  const [urls, setUrls] = useState(new Map<Blob, string>())
  useEffect(() => {
    const wanted = new Set(blobs.filter((blob): blob is Blob => !!blob))
    let changed = false
    for (const [blob, url] of owned.current) {
      if (!wanted.has(blob)) { URL.revokeObjectURL(url); owned.current.delete(blob); changed = true }
    }
    for (const blob of wanted) {
      if (!owned.current.has(blob)) { owned.current.set(blob, URL.createObjectURL(blob)); changed = true }
    }
    if (changed) setUrls(new Map(owned.current))
  }, [blobs])
  useEffect(() => {
    const current = owned.current
    return () => { for (const url of current.values()) URL.revokeObjectURL(url); current.clear() }
  }, [])
  return urls
}
