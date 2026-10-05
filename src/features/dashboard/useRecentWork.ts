import { useEffect, useState } from 'react'
import { readRecentWork, RECENT_WORK_CHANGED, recentWorkKey } from './recentWork'

export function useRecentWork(ownerId: string) {
  const [work, setWork] = useState(() => readRecentWork(ownerId))
  useEffect(() => {
    const update = () => setWork(readRecentWork(ownerId))
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === ownerId) update() }
    const stored = (event: StorageEvent) => { if (event.key === recentWorkKey(ownerId) || event.key === null) update() }
    window.addEventListener(RECENT_WORK_CHANGED, changed)
    window.addEventListener('storage', stored)
    return () => {
      window.removeEventListener(RECENT_WORK_CHANGED, changed)
      window.removeEventListener('storage', stored)
    }
  }, [ownerId])
  return work
}
