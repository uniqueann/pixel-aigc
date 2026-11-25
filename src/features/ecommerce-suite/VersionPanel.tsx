import { useEffect, useState } from 'react'
import { Button, Empty, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatDateTime } from '@/i18n/format'
import type { SuiteProject, SuiteSlotVersion } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import { suiteWorkstationToolLabel } from './i18n'

export default function VersionPanel({ client, project, slotId, versions, disabled, onSelect, onError }: {
  client: SuiteClient; project: SuiteProject; slotId: string; versions: SuiteSlotVersion[]; disabled: boolean;
  onSelect: (version: SuiteSlotVersion) => Promise<void>; onError: (error: unknown) => void
}) {
  const { t } = useTranslation('ecommerce')
  const [history, setHistory] = useState<SuiteSlotVersion[]>([])
  const [next, setNext] = useState<string | null>()
  useEffect(() => {
    let cancelled = false
    void client.versions(project.id, slotId).then(page => { if (!cancelled) { setHistory(page.items); setNext(page.nextCursor) } }).catch(error => { if (!cancelled) onError(error) })
    return () => { cancelled = true }
  }, [client, project.id, slotId, onError])
  const all = [...new Map([...history, ...versions.filter(version => version.slotId === slotId)].map(version => [version.id, version])).values()].sort((a, b) => b.versionNumber - a.versionNumber)
  const current = project.slotHeads.find(head => head.slotId === slotId)?.activeVersionId
  return <div className="suite-versions">{!all.length && <Empty description={t('versions.empty')} />}
    {all.map(version => <article key={version.id}><div><strong>{t('versions.versionTitle', { version: version.versionNumber })}</strong> {current === version.id ? <Tag color="green">{t('versions.currentTag')}</Tag> : <Tag>{t('versions.alternativeTag')}</Tag>}</div>
      <p>{t('versions.metaLine', { source: t(`versions.sources.${version.source}`), width: version.composition.renderSize.width, height: version.composition.renderSize.height, count: version.composition.layersSnapshot.length })}</p>
      {version.sourceTool && <p className="suite-muted">{t('versions.sourceToolLine', { tool: suiteWorkstationToolLabel(version.sourceTool) })}</p>}
      <p className="suite-muted">{formatDateTime(version.createdAt)}</p>
      <Button disabled={disabled || current === version.id} onClick={() => { void onSelect(version).catch(onError) }}>{t('versions.setCurrentButton')}</Button>
    </article>)}
    {next && <Button disabled={disabled} onClick={() => { void client.versions(project.id, slotId, next).then(page => { setHistory(old => [...old, ...page.items]); setNext(page.nextCursor) }).catch(onError) }}>{t('versions.loadOlderButton')}</Button>}
  </div>
}
