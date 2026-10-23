import { Button, Checkbox, Input, InputNumber, Select } from 'antd'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import type { SuiteFact, SuiteProjectConfig, SuiteSubcategory } from '@shared/ecommerce-suite'
import { isSuiteFactReady } from '@shared/ecommerce-suite'
import { changeSuiteCategory } from './config'
import { SUITE_RULE_VERSION } from '@shared/ecommerce-suite-precheck'

export default function ProductFields({ value, onChange, creating = false, disabled = false }: {
  value: SuiteProjectConfig; onChange: (value: SuiteProjectConfig) => void; creating?: boolean; disabled?: boolean
}) {
  const setFact = (id: string, patch: Partial<SuiteFact>) => onChange({
    ...value,
    facts: value.facts.map(fact => {
      if (fact.id !== id) return fact
      const next = { ...fact, ...patch, confirmed: 'confirmed' in patch ? patch.confirmed : fact.confirmed } as SuiteFact
      return isSuiteFactReady({ ...next, confirmed: true }) ? next : { ...next, confirmed: false } as SuiteFact
    }),
  })
  const addFact = (kind: 'dimension' | 'feature') => {
    const common = { id: crypto.randomUUID(), name: kind === 'dimension' ? '长' : '核心卖点', originalText: kind === 'dimension' ? '长（待填写）' : '核心卖点（待填写）', source: 'user' as const, confirmed: false as const }
    const fact: SuiteFact = kind === 'dimension' ? { ...common, kind, subject: '', axis: 'length', value: 0, unit: 'cm' } : { ...common, kind, value: '' }
    onChange({ ...value, facts: [...value.facts, fact] })
  }
  return <fieldset className="suite-product-fields" disabled={disabled}>
    <label>商品名称<Input aria-label="商品名称" value={value.title} maxLength={100} disabled={disabled} placeholder="例如：布艺三人沙发" onChange={event => onChange({ ...value, title: event.target.value })} /></label>
    <label>商品 SKU（选填）<Input aria-label="商品 SKU" value={value.sku ?? ''} maxLength={100} disabled={disabled} placeholder="选填，便于与店铺商品对应" onChange={event => onChange({ ...value, sku: event.target.value.trim() || undefined })} /></label>
    {creating && <label>商品品类<Select aria-label="商品品类" value={value.subcategory} disabled={disabled} options={Object.entries(SUITE_CATEGORY_TEMPLATES).map(([id, item]) => ({ value: id, label: item.label }))}
      onChange={(category: SuiteSubcategory) => onChange(changeSuiteCategory(value, category))} /></label>}
    <label>目标电商平台<Select aria-label="目标电商平台" value={value.platform} disabled={disabled} options={[{ value: 'amazon', label: 'Amazon 美国站' }, { value: 'general', label: '通用模板' }]}
      onChange={platform => onChange({ ...value, platform, marketplace: platform === 'amazon' ? 'US' : undefined,
        ruleProfile: { id: platform === 'amazon' ? 'amazon-us-home-kitchen' : 'general', version: SUITE_RULE_VERSION },
        slots: value.slots.map(slot => slot.kind === 'main' && platform === 'amazon' ? { ...slot, enabled: true } : slot) })} /></label>
    <label>文案语言<Select aria-label="成品文案语言" value={value.copyLanguage} disabled={disabled} options={[{ value: 'zh-CN', label: '中文' }, { value: 'en-US', label: '英文' }]} onChange={copyLanguage => onChange({ ...value, copyLanguage })} /></label>
    <label>尺寸单位<Select aria-label="尺寸单位" value={value.unitSystem} disabled={disabled} options={[{ value: 'metric', label: '公制 (cm, m)' }, { value: 'imperial', label: '英制 (in, ft)' }]} onChange={unitSystem => onChange({ ...value, unitSystem })} /></label>
    <label>统一场景风格<Input aria-label="统一场景风格" value={value.style.sceneTone} maxLength={100} disabled={disabled} placeholder="例如：现代极简、温馨原木" onChange={event => onChange({ ...value, style: { ...value.style, sceneTone: event.target.value } })} /></label>
    <label>风格与特征标签<Select mode="tags" aria-label="商品描述标签" value={value.tags} disabled={disabled} maxCount={30} tokenSeparators={['，', ',']} placeholder="点击或输入标签，按回车添加" options={SUITE_CATEGORY_TEMPLATES[value.subcategory].styleTags.map(tag => ({ value: tag }))}
      onChange={tags => onChange({ ...value, tags: [...new Set(tags.map((tag: string) => tag.trim()).filter(Boolean))] })} /></label>
    <p className="suite-muted">支持选择推荐标签或自由输入标签；具体尺寸规格与功能卖点可在下方补充添加。</p>
    <div className="suite-fact-heading"><strong>商品规格与卖点</strong><Button size="small" disabled={disabled || value.facts.length >= 50} onClick={() => addFact('dimension')}>+ 添加尺寸</Button><Button size="small" disabled={disabled || value.facts.length >= 50} onClick={() => addFact('feature')}>+ 添加卖点</Button></div>
    {value.facts.map(fact => <div className="suite-fact" key={fact.id}>
      <Input aria-label="规格名称" value={fact.name} disabled={disabled} maxLength={100} placeholder="规格名称（如长/宽/高/卖点）" onChange={event => setFact(fact.id, { name: event.target.value, originalText: `${event.target.value} ${fact.value}${'unit' in fact ? fact.unit : ''}` })} />
      {fact.kind === 'dimension' ? <>
        <Input aria-label="测量对象" placeholder="测量部位（如整体、坐垫，必填）" value={fact.subject} maxLength={60} onChange={event => setFact(fact.id, { subject: event.target.value })} />
        <Select aria-label="尺寸方向" value={fact.axis} options={[['length', '长度'], ['width', '宽度'], ['height', '高度'], ['depth', '深度'], ['diameter', '直径']].map(([value, label]) => ({ value, label }))} onChange={axis => setFact(fact.id, { axis })} />
        <InputNumber aria-label="尺寸数值" min={0.01} placeholder="请填写数值" value={fact.value > 0 ? fact.value : null} onChange={number => setFact(fact.id, { value: number ?? 0, originalText: `${fact.name} ${number ?? 0}${fact.unit}` })} />
        <Select aria-label="尺寸单位" value={fact.unit} options={['cm', 'm', 'mm', 'in', 'ft'].map(unit => ({ value: unit }))} onChange={unit => setFact(fact.id, { unit, originalText: `${fact.name} ${fact.value}${unit}` })} />
      </> : <Input aria-label="卖点内容" placeholder="卖点描述（如高回弹海绵、久坐不塌）" value={String(fact.value)} maxLength={200} onChange={event => setFact(fact.id, { value: event.target.value, originalText: `${fact.name} ${event.target.value}` })} />}
      <Checkbox checked={fact.confirmed} disabled={disabled || (!fact.confirmed && !isSuiteFactReady({ ...fact, confirmed: true }))} onChange={event => setFact(fact.id, { confirmed: event.target.checked, originalText: `${fact.name} ${fact.value}${'unit' in fact ? fact.unit : ''}` })}><span title={isSuiteFactReady({ ...fact, confirmed: true }) ? undefined : '请先填写完整内容再启用'}>{isSuiteFactReady({ ...fact, confirmed: true }) ? '启用此项' : '启用此项（请先填写完整）'}</span></Checkbox>
      <Button type="text" danger disabled={disabled} onClick={() => onChange({ ...value, facts: value.facts.filter(item => item.id !== fact.id) })}>删除</Button>
    </div>)}
    <div className="suite-fact-heading"><strong>要生成的槽位</strong></div>
    {value.slots.map(slot => <Checkbox key={slot.id} checked={slot.enabled} disabled={disabled || (value.platform === 'amazon' && slot.kind === 'main')}
      onChange={event => onChange({ ...value, slots: value.slots.map(item => item.id === slot.id ? { ...item, enabled: event.target.checked } : item) })}>{slot.name}</Checkbox>)}
  </fieldset>
}
