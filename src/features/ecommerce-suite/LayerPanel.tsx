import { Alert, Button, Input, InputNumber, Select } from 'antd'
import type { SuiteComposition, SuiteLayer, SuiteProjectConfig, SuiteSlotDraft } from '@shared/ecommerce-suite'
import { formatSuiteFact, orderSuiteLayers, SUITE_TEXT_BACKGROUNDS } from '@shared/ecommerce-suite-annotations'

export default function LayerPanel({ draft, composition, config, selectedId, locked, disabled, error, stale, onSelect, onEdit, onSave, onReset, onReadCloud }: {
  draft?: SuiteSlotDraft; composition?: SuiteComposition; config: SuiteProjectConfig; selectedId?: string; locked: boolean; disabled: boolean; error?: string; stale: boolean;
  onSelect: (id: string) => void; onEdit: (patch: Partial<SuiteSlotDraft>) => void; onSave: () => void; onReset: () => void; onReadCloud: () => void; onDownloadArchives?: () => void
}) {
  if (!draft || !composition) return <div className="suite-layer-panel"><Alert type="info" message={stale ? '原草稿版本已更新，本机编辑仍已保留' : '当前槽位尚未生成图片，生成后即可添加文字与标注。'} />
    {stale && <Button disabled={disabled} onClick={onReset}>使用当前图片并继续编辑</Button>}
  </div>
  const layers = draft.layers, selected = layers.find(layer => layer.id === selectedId)
  const modify = (patch: Partial<SuiteLayer>) => onEdit({ layers: layers.map(layer => layer.id === selectedId ? { ...layer, ...patch } as SuiteLayer : layer) })
  const availableFacts = config.facts.filter(fact => fact.confirmed && typeof fact.value === 'number')
  const canEdit = !disabled && !locked && !stale
  const add = (type: 'text' | 'dimension') => {
    if (layers.length >= 20 || !canEdit) return
    const id = crypto.randomUUID(), size = Math.max(10, Math.round(composition.renderSize.width * .035)), zIndex = layers.length
    const layer: SuiteLayer = type === 'text' ? { id, type, text: config.copyLanguage === 'zh-CN' ? '编辑文字' : 'Edit text', position: { x: .1, y: .1 }, width: .6,
      fontFamily: config.copyLanguage === 'zh-CN' ? 'Noto Sans SC' : 'Noto Sans', fontSize: Math.min(1000, size), fontWeight: 500, color: '#111827', background: '#ffffff', align: 'center', zIndex }
      : { id, type, factId: availableFacts[0].id, start: { x: .15, y: .8 }, end: { x: .85, y: .8 }, labelPosition: { x: .5, y: .8 },
        color: '#111827', strokeWidth: Math.max(1, Math.min(100, size / 12)), fontSize: Math.min(1000, size), zIndex }
    const facts = new Map((draft.factsSnapshot ?? composition.factsSnapshot).map(fact => [fact.id, fact]))
    if (type === 'dimension') facts.set(availableFacts[0].id, availableFacts[0])
    onEdit({ layers: [...layers, layer], factsSnapshot: [...facts.values()] }); onSelect(id)
  }
  return <div className="suite-layer-panel">
    {locked && <Alert type="info" message="Amazon 主图规范禁止叠加文字、水印或角标，此槽位已锁定图层编辑。" />}
    {stale && <Alert type="warning" message="当前版本已更新，原图层草稿已为您保留" action={<Button size="small" disabled={disabled} onClick={onReset}>继续编辑当前版本</Button>} />}
    {error && <Alert type="warning" message={error} action={<Button size="small" disabled={disabled} onClick={onReadCloud}>同步云端草稿</Button>} />}
    <div className="suite-actions"><Button disabled={!canEdit || layers.length >= 20} onClick={() => add('text')}>+ 添加文字</Button><Button disabled={!canEdit || layers.length >= 20 || !availableFacts.length} onClick={() => add('dimension')}>+ 添加尺寸线</Button></div>
    {!availableFacts.length && <p className="suite-muted">在商品信息中添加长宽高或规格数值后，可在此一键添加尺寸标注线。</p>}
    <p className="suite-muted">{layers.length}/20 层 · 在画板中直接拖拽定位；方向键微调（按住 Shift 加速）。</p>
    <div className="suite-layer-list">{orderSuiteLayers(layers).map((layer, index) => <div key={layer.id} className="suite-layer-row">
      <button type="button" aria-pressed={layer.id === selectedId} onClick={() => onSelect(layer.id)}>{layer.type === 'text' ? layer.text || '空文字草稿' : `规格标注 ${index + 1}`}</button>
      <Button size="small" aria-label="图层下移" disabled={!canEdit || index === 0} onClick={() => {
        const sorted = orderSuiteLayers(layers); [sorted[index - 1], sorted[index]] = [sorted[index], sorted[index - 1]]; onEdit({ layers: sorted.map((layer, zIndex) => ({ ...layer, zIndex })) })
      }}>↓</Button><Button size="small" aria-label="图层上移" disabled={!canEdit || index === layers.length - 1} onClick={() => {
        const sorted = orderSuiteLayers(layers); [sorted[index + 1], sorted[index]] = [sorted[index], sorted[index + 1]]; onEdit({ layers: sorted.map((layer, zIndex) => ({ ...layer, zIndex })) })
      }}>↑</Button><Button size="small" danger aria-label="删除图层" disabled={!canEdit} onClick={() => onEdit({ layers: layers.filter(item => item.id !== layer.id).map((item, zIndex) => ({ ...item, zIndex })) })}>删除</Button>
    </div>)}</div>
    {selected?.type === 'text' && <>
      <label>文字<Input.TextArea aria-label="图层文字" value={selected.text} maxLength={200} showCount rows={3} disabled={!canEdit} onChange={event => modify({ text: event.target.value })} /></label>
      <div className="suite-settings-row"><label>字体<Select value={selected.fontFamily} disabled={!canEdit} options={['Noto Sans SC', 'Noto Sans'].map(value => ({ value, label: value }))} onChange={fontFamily => modify({ fontFamily })} /></label>
        <label>字重<Select value={selected.fontWeight} disabled={!canEdit} options={[400, 500, 600, 700].map(value => ({ value, label: String(value) }))} onChange={fontWeight => modify({ fontWeight: fontWeight as 400 | 500 | 600 | 700 })} /></label></div>
      <div className="suite-settings-row"><label>文本宽度（%）<InputNumber aria-label="文本宽度百分比" min={5} max={100} value={Math.round(selected.width * 100)} disabled={!canEdit} onChange={value => value && modify({ width: value / 100 })} /></label>
        <label>对齐<Select value={selected.align} disabled={!canEdit} options={[{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]} onChange={align => modify({ align })} /></label></div>
      <label>胶囊底色<div className="suite-actions">{[...SUITE_TEXT_BACKGROUNDS, 'transparent'].map(color => <button type="button" key={color} className="suite-swatch" aria-label={`底色 ${color}`} aria-pressed={selected.background === color} disabled={!canEdit} style={{ background: color }} onClick={() => modify({ background: color })}>{color === 'transparent' ? '无' : ''}</button>)}</div></label>
    </>}
    {selected?.type === 'dimension' && <>
      <label>引用规格<Select aria-label="标注规格" value={selected.factId} disabled={!canEdit} options={(draft.factsSnapshot ?? composition.factsSnapshot).filter(fact => typeof fact.value === 'number').map(fact => ({ value: fact.id, label: `${fact.name} · ${formatSuiteFact(fact, composition.unitSystem)}` }))} onChange={factId => modify({ factId })} /></label>
      <Button disabled={!canEdit} onClick={() => onEdit({ factsSnapshot: config.facts.filter(fact => fact.confirmed), unitSystem: config.unitSystem, copyLanguage: config.copyLanguage })}>同步商品最新规格</Button>
      <p className="suite-muted">尺寸数值从商品规格中引用。画板中的端点与标签可自由拖动；修改数值请在商品信息中调整。</p>
      <label>线宽<InputNumber min={1} max={100} value={selected.strokeWidth} disabled={!canEdit} onChange={value => value && modify({ strokeWidth: value })} /></label>
      {(['start','end','labelPosition'] as const).map(point => <div className="suite-settings-row" key={point}>{(['x','y'] as const).map(axis => <label key={axis}>
        {{start:'起点',end:'终点',labelPosition:'标签'}[point]} {axis === 'x' ? '横向' : '纵向'}（%）
        <InputNumber min={0} max={100} step={.1} value={Number((selected[point][axis]*100).toFixed(2))} disabled={!canEdit}
          onChange={value => value !== null && modify({ [point]: { ...selected[point], [axis]: value/100 } })} />
      </label>)}</div>)}
    </>}
    {selected && <div className="suite-settings-row"><label>字号（画板像素）<InputNumber aria-label="图层字号" min={1} max={1000} value={selected.fontSize} disabled={!canEdit} onChange={value => value && modify({ fontSize: value })} /></label>
      <label>文字／线条颜色<input type="color" aria-label="图层颜色" value={selected.color} disabled={!canEdit} onChange={event => modify({ color: event.target.value })} /></label></div>}
    {selected?.type === 'text' && <div className="suite-settings-row">{(['x','y'] as const).map(axis => <label key={axis}>文字{axis === 'x' ? '横向' : '纵向'}（%）
      <InputNumber min={0} max={100} step={.1} value={Number((selected.position[axis]*100).toFixed(2))} disabled={!canEdit}
        onChange={value => value !== null && modify({ position: { ...selected.position, [axis]: value/100 } })} /></label>)}</div>}
    <div className="suite-actions"><Button block type="primary" disabled={!canEdit} onClick={onSave}>保存图层修改</Button></div>
    <p className="suite-muted">图层修改即时预览，保存图层不消耗积分。</p>
  </div>
}
