import { useEffect, useState } from 'react'
import { PlayCircleOutlined } from '@ant-design/icons'
import { readOwnedVideoUrl } from '@/services/api/ownedVideos'
import { useUserStore } from '@/store/useUserStore'

export default function VideoPoster({ posterKey, ownerId, retentionExpiresAt }: { posterKey?: string; ownerId?: string; retentionExpiresAt?: string }) {
  const userId = useUserStore(state => state.userId)
  const [poster, setPoster] = useState<{ key: string; url: string; userId: string | null }>()
  useEffect(() => {
    if (!posterKey) return
    const controller = new AbortController()
    void readOwnedVideoUrl({ objectKey: posterKey, retentionExpiresAt }, { ownerId, signal: controller.signal })
      .then(signed => { if (!controller.signal.aborted) setPoster({ key: posterKey, url: signed.url, userId }) }).catch(() => undefined)
    return () => controller.abort()
  }, [posterKey, ownerId, retentionExpiresAt, userId])
  return poster && poster.key === posterKey && poster.userId === userId
    ? <img src={poster.url} loading="lazy" alt="视频封面" />
    : <span className="preview-video-poster"><PlayCircleOutlined /> 视频</span>
}
