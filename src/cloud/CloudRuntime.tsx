import { useEffect } from 'react'
import { cloudEnabled } from './client'
import { startCloudSync } from './sync'
export default function CloudRuntime() {
  useEffect(() => { if (cloudEnabled) return startCloudSync() }, [])
  return null
}
