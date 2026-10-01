// Blob 地址只存在于当前页面运行时，每个视图或素材引用单独持有租约。
const entries = new Map<string, { blob: Blob; users: number }>()
const urls = new WeakMap<Blob, string>()
export function retainImageBlob(blob: Blob) {
  let url = urls.get(blob)
  if (!url || !entries.has(url)) { url = URL.createObjectURL(blob); urls.set(blob, url); entries.set(url, { blob, users: 0 }) }
  entries.get(url)!.users++
  let released = false
  return { url, release: () => {
    if (released) return
    released = true
    const entry = entries.get(url!)
    if (entry && --entry.users === 0) { entries.delete(url!); urls.delete(blob); URL.revokeObjectURL(url!) }
  } }
}
export function runtimeImageBlob(url: string) { return entries.get(url)?.blob }
