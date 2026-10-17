import { useEffect, useState } from 'react'
import { Button, Empty, Tag } from 'antd'
import type { SuiteProject, SuiteSlotVersion } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'

export default function VersionPanel({ client, project, slotId, versions, disabled, onSelect, onError }: {
  client: SuiteClient; project: SuiteProject; slotId: string; versions: SuiteSlotVersion[]; disabled: boolean;
  onSelect: (version: SuiteSlotVersion) => Promise<void>; onError: (error: unknown) => void
}) {
  const [history, setHistory] = useState<SuiteSlotVersion[]>([])
  const [next, setNext] = useState<string | null>()
  useEffect(() => {
    let cancelled = false
    void client.versions(project.id, slotId).then(page => { if (!cancelled) { setHistory(page.items); setNext(page.nextCursor) } }).catch(error => { if (!cancelled) onError(error) })
    return () => { cancelled = true }
  }, [client, project.id, slotId, onError])
  const all = [...new Map([...history, ...versions.filter(version => version.slotId === slotId)].map(version => [version.id, version])).values()].sort((a, b) => b.versionNumber - a.versionNumber)
  const current = project.slotHeads.find(head => head.slotId === slotId)?.activeVersionId
  return <div className="suite-versions">{!all.length && <Empty description="尚无候选版本" />}
    {all.map(version => <article key={version.id}><div><strong>版本 {version.versionNumber}</strong> {current === version.id ? <Tag color="green">当前底图</Tag> : <Tag>候选</Tag>}</div>
      <p>{version.source === 'reuse' ? '原图复用' : '图片生成'} · {version.composition.renderSize.width} × {version.composition.renderSize.height}</p>
      <p className="suite-muted">{new Date(version.createdAt).toLocaleString()}</p>
      <Button disabled={disabled || current === version.id} onClick={() => { void onSelect(version).catch(onError) }}>设为当前版本</Button>
    </article>)}
    {next && <Button disabled={disabled} onClick={() => { void client.versions(project.id, slotId, next).then(page => { setHistory(old => [...old, ...page.items]); setNext(page.nextCursor) }).catch(onError) }}>加载更早版本</Button>}
  </div>
}
