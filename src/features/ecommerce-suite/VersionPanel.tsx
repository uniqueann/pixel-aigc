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
    {all.map(version => <article key={version.id}><div><strong>版本 {version.versionNumber}</strong> {current === version.id ? <Tag color="green">当前成品</Tag> : <Tag>候选</Tag>}</div>
      <p>{{ reuse: '原图复用', generated: '图片生成', annotation_edit: '图层编辑', workstation_return: '工作站回填' }[version.source]} · {version.composition.renderSize.width} × {version.composition.renderSize.height} · {version.composition.layersSnapshot.length} 个图层</p>
      {version.sourceTool && <p>原工具：{version.sourceTool}；来源版本保留在历史中，回填结果需手动设为当前。</p>}
      <p className="suite-muted">{new Date(version.createdAt).toLocaleString()}</p>
      <Button disabled={disabled || current === version.id} onClick={() => { void onSelect(version).catch(onError) }}>设为当前版本</Button>
    </article>)}
    {next && <Button disabled={disabled} onClick={() => { void client.versions(project.id, slotId, next).then(page => { setHistory(old => [...old, ...page.items]); setNext(page.nextCursor) }).catch(onError) }}>加载更早版本</Button>}
  </div>
}
