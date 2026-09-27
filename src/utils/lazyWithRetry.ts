import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { isChunkLoadError, reloadOnceForChunkError } from './chunkLoadError'

const RETRY_DELAY_MS = 400

export async function importWithChunkRecovery<T>(
  importer: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  try {
    return await importer()
  } catch (error) {
    if (!isChunkLoadError(error)) throw error
    if (attempts > 1) {
      await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS))
      return importWithChunkRecovery(importer, attempts - 1)
    }
    if (reloadOnceForChunkError()) {
      return new Promise<T>(() => undefined)
    }
    throw error
  }
}

export function lazyWithRetry<P>(
  importer: () => Promise<{ default: ComponentType<P> }>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => importWithChunkRecovery(importer))
}
