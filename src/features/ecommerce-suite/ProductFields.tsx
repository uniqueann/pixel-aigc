import { Button, Checkbox, Input, InputNumber, Select } from 'antd'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import type { SuiteFact, SuiteProjectConfig, SuiteSubcategory } from '@shared/ecommerce-suite'
import { changeSuiteCategory } from './config'
import { SUITE_RULE_VERSION } from '@shared/ecommerce-suite-precheck'

export default function ProductFields({ value, onChange, creating = false, disabled = false }: {
  value: SuiteProjectConfig; onChange: (value: SuiteProjectConfig) => void; creating?: boolean; disabled?: boolean
}) {
  const setFact = (id: string, patch: Partial<SuiteFact>) => onChange({ ...value, facts: value.facts.map(fact => fact.id === id ? { ...fact, ...patch, confirmed: 'confirmed' in patch ? patch.confirmed : false } as SuiteFact : fact) })
  const addFact = (kind: 'dimension' | 'feature') => {
    const common = { id: crypto.randomUUID(), name: kind === 'dimension' ? '长度' : '商品卖点', originalText: '用户手动填写，待确认', source: 'user' as const, confirmed: false }
    const fact: SuiteFact = kind === 'dimension' ? { ...common, kind, subject: 'product', axis: 'length', value: 1, unit: 'cm' } : { ...common, kind, value: '' }
    onChange({ ...value, facts: [...value.facts, fact] })
  }
  return <fieldset className="suite-product-fields" disabled={disabled}>
    <label>商品名称<Input aria-label="商品名称" value={value.title} maxLength={100} disabled={disabled} onChange={event => onChange({ ...value, title: event.target.value })} /></label>
    <label>SKU（选填）<Input aria-label="商品 SKU" value={value.sku ?? ''} maxLength={100} disabled={disabled} onChange={event => onChange({ ...value, sku: event.target.value.trim() || undefined })} /></label>
    {creating && <label>商品子类<Select aria-label="商品子类" value={value.subcategory} disabled={disabled} options={Object.entries(SUITE_CATEGORY_TEMPLATES).map(([id, item]) => ({ value: id, label: item.label }))}
      onChange={(category: SuiteSubcategory) => onChange(changeSuiteCategory(value, category))} /></label>}
    <label>目标平台<Select aria-label="目标平台" value={value.platform} disabled={disabled} options={[{ value: 'amazon', label: 'Amazon 美国站' }, { value: 'general', label: '通用模板' }]}
      onChange={platform => onChange({ ...value, platform, marketplace: platform === 'amazon' ? 'US' : undefined,
        ruleProfile: { id: platform === 'amazon' ? 'amazon-us-home-kitchen' : 'general', version: SUITE_RULE_VERSION },
        slots: value.slots.map(slot => slot.kind === 'main' && platform === 'amazon' ? { ...slot, enabled: true } : slot) })} /></label>
    <p className="suite-muted">预检规则：{value.ruleProfile.version}。{value.ruleProfile.version !== SUITE_RULE_VERSION && <Button size="small" disabled={disabled} onClick={() => onChange({ ...value, ruleProfile: { id: value.platform === 'amazon' ? 'amazon-us-home-kitchen' : 'general', version: SUITE_RULE_VERSION } })}>更新为当前预检规则</Button>}</p>
    <label>文案语言<Select aria-label="成品文案语言" value={value.copyLanguage} disabled={disabled} options={[{ value: 'zh-CN', label: '中文' }, { value: 'en-US', label: '英文' }]} onChange={copyLanguage => onChange({ ...value, copyLanguage })} /></label>
    <label>规格单位<Select aria-label="规格单位" value={value.unitSystem} disabled={disabled} options={[{ value: 'metric', label: '公制' }, { value: 'imperial', label: '英制' }]} onChange={unitSystem => onChange({ ...value, unitSystem })} /></label>
    <label>统一场景风格<Input aria-label="统一场景风格" value={value.style.sceneTone} maxLength={100} disabled={disabled} onChange={event => onChange({ ...value, style: { ...value.style, sceneTone: event.target.value } })} /></label>
    <label>描述标签<Select mode="tags" aria-label="商品描述标签" value={value.tags} disabled={disabled} maxCount={30} tokenSeparators={['，', ',']} options={SUITE_CATEGORY_TEMPLATES[value.subcategory].styleTags.map(tag => ({ value: tag }))}
      onChange={tags => onChange({ ...value, tags: [...new Set(tags.map((tag: string) => tag.trim()).filter(Boolean))] })} /></label>
    <p className="suite-muted">推荐标签只描述风格。材质、尺寸与功能请在下方填写并确认；自定义标签会保存供编辑参考，当前只将推荐风格和已确认事实用于生成。</p>
    <div className="suite-fact-heading"><strong>商品事实与规格</strong><Button size="small" disabled={disabled || value.facts.length >= 50} onClick={() => addFact('dimension')}>添加尺寸</Button><Button size="small" disabled={disabled || value.facts.length >= 50} onClick={() => addFact('feature')}>添加卖点</Button></div>
    {value.facts.map(fact => <div className="suite-fact" key={fact.id}>
      <Input aria-label="事实名称" value={fact.name} disabled={disabled} maxLength={100} onChange={event => setFact(fact.id, { name: event.target.value })} />
      {fact.kind === 'dimension' ? <>
        <Input aria-label="测量对象" placeholder="测量对象，例如整体或扶手" value={fact.subject} maxLength={60} onChange={event => setFact(fact.id, { subject: event.target.value })} />
        <Select aria-label="尺寸方向" value={fact.axis} options={[['length', '长度'], ['width', '宽度'], ['height', '高度'], ['depth', '深度'], ['diameter', '直径']].map(([value, label]) => ({ value, label }))} onChange={axis => setFact(fact.id, { axis })} />
        <InputNumber aria-label="尺寸数值" min={0.01} value={fact.value} onChange={number => setFact(fact.id, { value: number ?? 0 })} />
        <Select aria-label="尺寸单位" value={fact.unit} options={['mm', 'cm', 'm', 'in', 'ft'].map(unit => ({ value: unit }))} onChange={unit => setFact(fact.id, { unit })} />
      </> : <Input aria-label="事实内容" value={String(fact.value)} maxLength={200} onChange={event => setFact(fact.id, { value: event.target.value })} />}
      <Checkbox checked={fact.confirmed} disabled={disabled} onChange={event => setFact(fact.id, { confirmed: event.target.checked, originalText: `${fact.name} ${fact.value}${'unit' in fact ? fact.unit : ''}` })}>我已核对</Checkbox>
      <Button type="text" danger disabled={disabled} onClick={() => onChange({ ...value, facts: value.facts.filter(item => item.id !== fact.id) })}>删除</Button>
    </div>)}
    <div className="suite-fact-heading"><strong>启用槽位</strong></div>
    {value.slots.map(slot => <Checkbox key={slot.id} checked={slot.enabled} disabled={disabled || (value.platform === 'amazon' && slot.kind === 'main')}
      onChange={event => onChange({ ...value, slots: value.slots.map(item => item.id === slot.id ? { ...item, enabled: event.target.checked } : item) })}>{slot.name}</Checkbox>)}
  </fieldset>
}
