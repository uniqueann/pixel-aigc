import { useEffect, useState } from 'react'
import { PlayCircleOutlined } from '@ant-design/icons'
import { readOwnedVideoUrl } from '@/services/api/ownedVideos'
import { useUserStore } from '@/store/useUserStore'
import CoverPlaceholder from './CoverPlaceholder'

export default function VideoPoster({ posterKey, ownerId, retentionExpiresAt, variant = 'strip' }: {
  posterKey?: string
  ownerId?: string
  retentionExpiresAt?: string
  /** strip 用于自由画布结果条；cover 用于作品墙封面（同图铺底 + 统一占位）。 */
  variant?: 'strip' | 'cover'
}) {
  const userId = useUserStore(state => state.userId)
  const [poster, setPoster] = useState<{ key: string; url: string; userId: string | null; ownerId?: string }>()
  useEffect(() => {
    if (!posterKey) return
    const controller = new AbortController()
    void readOwnedVideoUrl({ objectKey: posterKey, retentionExpiresAt }, { ownerId, signal: controller.signal })
      .then(signed => { if (!controller.signal.aborted) setPoster({ key: posterKey, url: signed.url, userId, ownerId }) }).catch(() => undefined)
    return () => controller.abort()
  }, [posterKey, ownerId, retentionExpiresAt, userId])
  // 铺底与海报共用同一个守卫：posterKey 变化后不会闪上一张的铺底。
  if (!poster || poster.key !== posterKey || poster.userId !== userId || poster.ownerId !== ownerId) {
    return variant === 'cover'
      ? <CoverPlaceholder icon={<PlayCircleOutlined />} />
      : <span className="preview-video-poster"><PlayCircleOutlined /> 视频</span>
  }
  return (
    <>
      {variant === 'cover'
        ? <img className="cover-backdrop" src={poster.url} alt="" loading="lazy" decoding="async" />
        : null}
      <img
        src={poster.url}
        loading="lazy"
        decoding="async"
        alt={variant === 'cover' ? '' : '视频封面'}
        onError={() => setPoster(undefined)}
      />
    </>
  )
}
