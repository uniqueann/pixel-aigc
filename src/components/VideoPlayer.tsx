import { useEffect, useRef, useState } from 'react'
import { Button, Spin } from 'antd'
import { readOwnedVideoUrl, type OwnedVideoReference } from '@/services/api/ownedVideos'
import { useUserStore } from '@/store/useUserStore'

export default function VideoPlayer({ reference, ownerId }: { reference: OwnedVideoReference; ownerId?: string }) {
  const userId = useUserStore(state => state.userId)
  const video = useRef<HTMLVideoElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [source, setSource] = useState<string>()
  const [error, setError] = useState<string>()
  const { objectKey, url, expiresAt, retentionExpiresAt } = reference
  useEffect(() => {
    const controller = new AbortController()
    const element = video.current
    let timer: ReturnType<typeof setTimeout> | undefined
    queueMicrotask(() => { if (!controller.signal.aborted) { setSource(undefined); setError(undefined) } })
    void readOwnedVideoUrl({ objectKey, url, expiresAt, retentionExpiresAt }, { ownerId, signal: controller.signal, force: attempt > 0 })
      .then(signed => {
        if (controller.signal.aborted) return
        setSource(signed.url)
        const expiry = Math.min(signed.expiresAt ?? Infinity, retentionExpiresAt ? new Date(retentionExpiresAt).getTime() : Infinity)
        if (Number.isFinite(expiry)) timer = setTimeout(() => { element?.pause(); setAttempt(value => value + 1) }, Math.max(1000, expiry - Date.now() - 1000))
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '视频读取失败') })
    return () => { controller.abort(); clearTimeout(timer); element?.pause(); element?.removeAttribute('src'); element?.load() }
  }, [objectKey, url, expiresAt, retentionExpiresAt, ownerId, userId, attempt])
  return <div className="preview-video-frame">
    {!source && !error && <Spin />}
    {error && <div role="alert">{error}<Button onClick={() => setAttempt(value => value + 1)}>重试读取</Button></div>}
    <video ref={video} src={source} controls playsInline preload="none" aria-label="视频预览" onError={() => setError('视频播放失败，请重试读取')} style={{ maxWidth: '80vw', maxHeight: '75vh' }} />
  </div>
}
