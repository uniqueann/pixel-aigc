const CHUNK_RELOAD_KEY = 'pixel-aigc:chunk-reload'

const CHUNK_ERROR_PATTERN = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk \d+ failed|ChunkLoadError/i

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && 'name' in error && error.name === 'ChunkLoadError') return true
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return CHUNK_ERROR_PATTERN.test(message)
}

export function consumeChunkReload(): boolean {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1'
  } catch {
    return false
  }
}

export function markChunkReload(): boolean {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1') return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
    return true
  } catch {
    return false
  }
}

/** 页面稳定后再清标记，下次发版仍可自动刷新一次。 */
export function clearChunkReloadMark() {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY)
  } catch {
    /* 隐私模式可能写不了 sessionStorage */
  }
}

export function reloadOnceForChunkError(): boolean {
  if (!markChunkReload()) return false
  window.location.reload()
  return true
}
