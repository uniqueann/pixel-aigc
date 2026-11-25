import { Alert, Button, Input, InputNumber, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SuiteComposition, SuiteLayer, SuiteProjectConfig, SuiteSlotDraft } from '@shared/ecommerce-suite'
import { formatSuiteFact, orderSuiteLayers, SUITE_TEXT_BACKGROUNDS } from '@shared/ecommerce-suite-annotations'
import { DEFAULT_ZH_ARTWORK_TEXT } from './i18n'

export default function LayerPanel({ draft, composition, config, selectedId, locked, disabled, error, stale, onSelect, onEdit, onSave, onReset, onReadCloud }: {
  draft?: SuiteSlotDraft; composition?: SuiteComposition; config: SuiteProjectConfig; selectedId?: string; locked: boolean; disabled: boolean; error?: string; stale: boolean;
  onSelect: (id: string) => void; onEdit: (patch: Partial<SuiteSlotDraft>) => void; onSave: () => void; onReset: () => void; onReadCloud: () => void; onDownloadArchives?: () => void
}) {
  const { t } = useTranslation(['ecommerce', 'common'])
  if (!draft || !composition) return <div className="suite-layer-panel"><Alert type="info" message={stale ? t('ecommerce:layers.staleEmptyNotice') : t('ecommerce:layers.noImageNotice')} />
    {stale && <Button disabled={disabled} onClick={onReset}>{t('ecommerce:layers.useCurrentAndEdit')}</Button>}
  </div>
  const layers = draft.layers, selected = layers.find(layer => layer.id === selectedId)
  const modify = (patch: Partial<SuiteLayer>) => onEdit({ layers: layers.map(layer => layer.id === selectedId ? { ...layer, ...patch } as SuiteLayer : layer) })
  const availableFacts = config.facts.filter(fact => fact.confirmed && typeof fact.value === 'number')
  const canEdit = !disabled && !locked && !stale
  const add = (type: 'text' | 'dimension') => {
    if (layers.length >= 20 || !canEdit) return
    const id = crypto.randomUUID(), size = Math.max(10, Math.round(composition.renderSize.width * .035)), zIndex = layers.length
    // Artwork copyLanguage controls generated poster copy text & font, independent of UI locale.
    const layer: SuiteLayer = type === 'text' ? { id, type, text: config.copyLanguage === 'zh-CN' ? DEFAULT_ZH_ARTWORK_TEXT : 'Edit text', position: { x: .1, y: .1 }, width: .6,
      fontFamily: config.copyLanguage === 'zh-CN' ? 'Noto Sans SC' : 'Noto Sans', fontSize: Math.min(1000, size), fontWeight: 500, color: '#111827', background: '#ffffff', align: 'center', zIndex }
      : { id, type, factId: availableFacts[0].id, start: { x: .15, y: .8 }, end: { x: .85, y: .8 }, labelPosition: { x: .5, y: .8 },
        color: '#111827', strokeWidth: Math.max(1, Math.min(100, size / 12)), fontSize: Math.min(1000, size), zIndex }
    const facts = new Map((draft.factsSnapshot ?? composition.factsSnapshot).map(fact => [fact.id, fact]))
    if (type === 'dimension') facts.set(availableFacts[0].id, availableFacts[0])
    onEdit({ layers: [...layers, layer], factsSnapshot: [...facts.values()] }); onSelect(id)
  }
  return <div className="suite-layer-panel">
    {locked && <Alert type="info" message={t('ecommerce:layers.mainLockedNotice')} />}
    {stale && <Alert type="warning" message={t('ecommerce:layers.staleNotice')} action={<Button size="small" disabled={disabled} onClick={onReset}>{t('ecommerce:layers.continueCurrentVersion')}</Button>} />}
    {error && <Alert type="warning" message={error} action={<Button size="small" disabled={disabled} onClick={onReadCloud}>{t('ecommerce:layers.syncCloudDraft')}</Button>} />}
    <div className="suite-actions"><Button disabled={!canEdit || layers.length >= 20} onClick={() => add('text')}>{t('ecommerce:layers.addText')}</Button><Button disabled={!canEdit || layers.length >= 20 || !availableFacts.length} onClick={() => add('dimension')}>{t('ecommerce:layers.addDimension')}</Button></div>
    {!availableFacts.length && <p className="suite-muted">{t('ecommerce:layers.addDimensionHint')}</p>}
    <p className="suite-muted">{t('ecommerce:layers.layerCountHint', { count: layers.length, max: 20 })}</p>
    <div className="suite-layer-list">{orderSuiteLayers(layers).map((layer, index) => <div key={layer.id} className="suite-layer-row">
      <button type="button" aria-pressed={layer.id === selectedId} onClick={() => onSelect(layer.id)}>{layer.type === 'text' ? layer.text || t('ecommerce:layers.emptyTextDraft') : t('ecommerce:layers.dimensionLayerItem', { index: index + 1 })}</button>
      <Button size="small" aria-label={t('ecommerce:layers.moveDownAria')} disabled={!canEdit || index === 0} onClick={() => {
        const sorted = orderSuiteLayers(layers); [sorted[index - 1], sorted[index]] = [sorted[index], sorted[index - 1]]; onEdit({ layers: sorted.map((layer, zIndex) => ({ ...layer, zIndex })) })
      }}>↓</Button><Button size="small" aria-label={t('ecommerce:layers.moveUpAria')} disabled={!canEdit || index === layers.length - 1} onClick={() => {
        const sorted = orderSuiteLayers(layers); [sorted[index + 1], sorted[index]] = [sorted[index], sorted[index + 1]]; onEdit({ layers: sorted.map((layer, zIndex) => ({ ...layer, zIndex })) })
      }}>↑</Button><Button size="small" danger aria-label={t('ecommerce:layers.deleteAria')} disabled={!canEdit} onClick={() => onEdit({ layers: layers.filter(item => item.id !== layer.id).map((item, zIndex) => ({ ...item, zIndex })) })}>{t('common:actions.delete')}</Button>
    </div>)}</div>
    {selected?.type === 'text' && <>
      <label>{t('ecommerce:layers.textLabel')}<Input.TextArea aria-label={t('ecommerce:layers.textAria')} value={selected.text} maxLength={200} showCount rows={3} disabled={!canEdit} onChange={event => modify({ text: event.target.value })} /></label>
      <div className="suite-settings-row"><label>{t('ecommerce:layers.fontLabel')}<Select value={selected.fontFamily} disabled={!canEdit} options={['Noto Sans SC', 'Noto Sans'].map(value => ({ value, label: value }))} onChange={fontFamily => modify({ fontFamily })} /></label>
        <label>{t('ecommerce:layers.weightLabel')}<Select value={selected.fontWeight} disabled={!canEdit} options={[400, 500, 600, 700].map(value => ({ value, label: String(value) }))} onChange={fontWeight => modify({ fontWeight: fontWeight as 400 | 500 | 600 | 700 })} /></label></div>
      <div className="suite-settings-row"><label>{t('ecommerce:layers.widthPercentLabel')}<InputNumber aria-label={t('ecommerce:layers.widthPercentAria')} min={5} max={100} value={Math.round(selected.width * 100)} disabled={!canEdit} onChange={value => value && modify({ width: value / 100 })} /></label>
        <label>{t('ecommerce:layers.alignLabel')}<Select value={selected.align} disabled={!canEdit} options={[{ value: 'left', label: t('ecommerce:layers.alignLeft') }, { value: 'center', label: t('ecommerce:layers.alignCenter') }, { value: 'right', label: t('ecommerce:layers.alignRight') }]} onChange={align => modify({ align })} /></label></div>
      <label>{t('ecommerce:layers.backgroundLabel')}<div className="suite-actions">{[...SUITE_TEXT_BACKGROUNDS, 'transparent'].map(color => <button type="button" key={color} className="suite-swatch" aria-label={t('ecommerce:layers.backgroundAria', { color })} aria-pressed={selected.background === color} disabled={!canEdit} style={{ background: color }} onClick={() => modify({ background: color })}>{color === 'transparent' ? t('ecommerce:layers.backgroundNone') : ''}</button>)}</div></label>
    </>}
    {selected?.type === 'dimension' && <>
      <label>{t('ecommerce:layers.factLabel')}<Select aria-label={t('ecommerce:layers.factAria')} value={selected.factId} disabled={!canEdit} options={(draft.factsSnapshot ?? composition.factsSnapshot).filter(fact => typeof fact.value === 'number').map(fact => ({ value: fact.id, label: `${fact.name} · ${formatSuiteFact(fact, composition.unitSystem)}` }))} onChange={factId => modify({ factId })} /></label>
      <Button disabled={!canEdit} onClick={() => onEdit({ factsSnapshot: config.facts.filter(fact => fact.confirmed), unitSystem: config.unitSystem, copyLanguage: config.copyLanguage })}>{t('ecommerce:layers.syncFactsButton')}</Button>
      <p className="suite-muted">{t('ecommerce:layers.dimensionNote')}</p>
      <label>{t('ecommerce:layers.strokeWidthLabel')}<InputNumber min={1} max={100} value={selected.strokeWidth} disabled={!canEdit} onChange={value => value && modify({ strokeWidth: value })} /></label>
    </>}
    {selected && <div className="suite-settings-row"><label>{t('ecommerce:layers.fontSizeLabel')}<InputNumber aria-label={t('ecommerce:layers.fontSizeAria')} min={1} max={1000} value={selected.fontSize} disabled={!canEdit} onChange={value => value && modify({ fontSize: value })} /></label>
      <label>{t('ecommerce:layers.colorLabel')}<input type="color" aria-label={t('ecommerce:layers.colorAria')} value={selected.color} disabled={!canEdit} onChange={event => modify({ color: event.target.value })} /></label></div>}
    {selected && <details className="suite-advanced-coords">
      <summary>{t('ecommerce:layers.advancedCoordsSummary')}</summary>
      {selected.type === 'text' && <div className="suite-settings-row">{(['x','y'] as const).map(axis => <label key={axis}>{t('ecommerce:layers.textCoordLabel', { axis: axis === 'x' ? t('ecommerce:layers.axisX') : t('ecommerce:layers.axisY') })}
        <InputNumber min={0} max={100} step={.1} value={Number((selected.position[axis]*100).toFixed(2))} disabled={!canEdit}
          onChange={value => value !== null && modify({ position: { ...selected.position, [axis]: value/100 } })} /></label>)}</div>}
      {selected.type === 'dimension' && (['start','end','labelPosition'] as const).map(point => <div className="suite-settings-row" key={point}>{(['x','y'] as const).map(axis => <label key={axis}>
        {t('ecommerce:layers.dimCoordLabel', { point: t(`ecommerce:layers.points.${point}`), axis: axis === 'x' ? t('ecommerce:layers.axisX') : t('ecommerce:layers.axisY') })}
        <InputNumber min={0} max={100} step={.1} value={Number((selected[point][axis]*100).toFixed(2))} disabled={!canEdit}
          onChange={value => value !== null && modify({ [point]: { ...selected[point], [axis]: value/100 } })} />
      </label>)}</div>)}
    </details>}
    <div className="suite-actions"><Button block disabled={!canEdit} onClick={onSave}>{t('ecommerce:layers.saveVersionButton')}</Button></div>
    <p className="suite-muted">{t('ecommerce:layers.autoSaveFootnote')}</p>
  </div>
}
