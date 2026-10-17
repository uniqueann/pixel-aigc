import { useEffect, useRef, useState } from 'react'
import type { SuiteAssetRef } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import { readSuiteBlob } from './backup'

export default function SuiteImage({ asset, client, offline = false, alt }: { asset?: SuiteAssetRef; client: SuiteClient; offline?: boolean; alt: string }) {
  const element = useRef<HTMLImageElement>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!asset) return
    let disposed = false, objectUrl: string | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const img = element.current!
    const refresh = async () => {
      try {
        client.assertCurrent()
        if (offline) {
          const blob = await readSuiteBlob(asset.actor, asset.projectId, asset.assetId)
          if (!blob) throw new Error('这张图片尚未备份到本机')
          if (disposed) return
          objectUrl = URL.createObjectURL(blob)
          img.src = objectUrl
        } else {
          const access = (await client.access(asset.projectId, [asset.assetId])).items[0]
          if (disposed) return
          img.src = access.url
          timer = setTimeout(() => { void refresh() }, Math.max(1000, access.expiresAt - Date.now() - 30000))
        }
        if (!disposed) setError('')
      } catch (error) { if (!disposed) setError(error instanceof Error ? error.message : '图片不可用') }
    }
    void refresh()
    return () => { disposed = true; clearTimeout(timer); img.removeAttribute('src'); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [asset, client, offline, retry])
  if (!asset) return <div className="suite-image-empty">选择槽位后生成，或先上传商品图</div>
  return <><img ref={element} alt={alt} hidden={Boolean(error)} onError={() => setError('图片地址已失效或文件无法读取')} />
    {error && <div className="suite-image-empty"><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)}>重新授权读取</button></div>}</>
}
