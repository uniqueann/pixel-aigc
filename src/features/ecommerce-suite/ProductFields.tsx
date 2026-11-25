import { Button, Checkbox, Input, InputNumber, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { SUITE_SUBCATEGORIES, isSuiteFactReady, type SuiteFact, type SuiteProjectConfig, type SuiteSubcategory } from '@shared/ecommerce-suite'
import { SUITE_RULE_VERSION } from '@shared/ecommerce-suite-precheck'
import { changeSuiteCategory } from './config'
import { suiteCategoryLabel, suitePlatformLabel, suiteSlotLabel, suiteStyleTagOptions } from './i18n'

export default function ProductFields({ value, onChange, creating = false, disabled = false }: {
  value: SuiteProjectConfig; onChange: (value: SuiteProjectConfig) => void; creating?: boolean; disabled?: boolean
}) {
  const { t } = useTranslation(['ecommerce', 'common'])
  const setFact = (id: string, patch: Partial<SuiteFact>) => onChange({
    ...value,
    facts: value.facts.map(fact => {
      if (fact.id !== id) return fact
      const next = { ...fact, ...patch, confirmed: 'confirmed' in patch ? patch.confirmed : fact.confirmed } as SuiteFact
      return isSuiteFactReady({ ...next, confirmed: true }) ? next : { ...next, confirmed: false } as SuiteFact
    }),
  })
  const addFact = (kind: 'dimension' | 'feature') => {
    const common = {
      id: crypto.randomUUID(),
      name: kind === 'dimension' ? t('ecommerce:facts.defaultDimensionName') : t('ecommerce:facts.defaultFeatureName'),
      originalText: kind === 'dimension' ? t('ecommerce:facts.defaultDimensionOriginalText') : t('ecommerce:facts.defaultFeatureOriginalText'),
      source: 'user' as const,
      confirmed: false as const,
    }
    const fact: SuiteFact = kind === 'dimension' ? { ...common, kind, subject: '', axis: 'length', value: 0, unit: 'cm' } : { ...common, kind, value: '' }
    onChange({ ...value, facts: [...value.facts, fact] })
  }
  const axisOptions = (['length', 'width', 'height', 'depth', 'diameter'] as const).map(axis => ({
    value: axis,
    label: t(`ecommerce:fields.axes.${axis}`),
  }))
  return <fieldset className="suite-product-fields" disabled={disabled}>
    <label>{t('ecommerce:fields.titleLabel')}<Input aria-label={t('ecommerce:fields.titleAria')} value={value.title} maxLength={100} disabled={disabled} placeholder={t('ecommerce:fields.titlePlaceholder')} onChange={event => onChange({ ...value, title: event.target.value })} /></label>
    <label>{t('ecommerce:fields.skuLabel')}<Input aria-label={t('ecommerce:fields.skuAria')} value={value.sku ?? ''} maxLength={100} disabled={disabled} placeholder={t('ecommerce:fields.skuPlaceholder')} onChange={event => onChange({ ...value, sku: event.target.value.trim() || undefined })} /></label>
    {creating && <label>{t('ecommerce:fields.categoryLabel')}<Select aria-label={t('ecommerce:fields.categoryAria')} value={value.subcategory} disabled={disabled} options={SUITE_SUBCATEGORIES.map(id => ({ value: id, label: suiteCategoryLabel(id) }))}
      onChange={(category: SuiteSubcategory) => onChange(changeSuiteCategory(value, category))} /></label>}
    <label>{t('ecommerce:fields.platformLabel')}<Select aria-label={t('ecommerce:fields.platformAria')} value={value.platform} disabled={disabled} options={[{ value: 'amazon', label: suitePlatformLabel('amazon') }, { value: 'general', label: suitePlatformLabel('general') }]}
      onChange={platform => onChange({ ...value, platform, marketplace: platform === 'amazon' ? 'US' : undefined,
        ruleProfile: { id: platform === 'amazon' ? 'amazon-us-home-kitchen' : 'general', version: SUITE_RULE_VERSION },
        slots: value.slots.map(slot => slot.kind === 'main' && platform === 'amazon' ? { ...slot, enabled: true } : slot) })} /></label>
    <label>{t('ecommerce:fields.copyLanguageLabel')}<Select aria-label={t('ecommerce:fields.copyLanguageAria')} value={value.copyLanguage} disabled={disabled} options={[{ value: 'zh-CN', label: t('ecommerce:fields.copyLanguageZh') }, { value: 'en-US', label: t('ecommerce:fields.copyLanguageEn') }]} onChange={copyLanguage => onChange({ ...value, copyLanguage })} /></label>
    <label>{t('ecommerce:fields.unitSystemLabel')}<Select aria-label={t('ecommerce:fields.unitSystemAria')} value={value.unitSystem} disabled={disabled} options={[{ value: 'metric', label: t('ecommerce:fields.unitMetric') }, { value: 'imperial', label: t('ecommerce:fields.unitImperial') }]} onChange={unitSystem => onChange({ ...value, unitSystem })} /></label>
    <label>{t('ecommerce:fields.sceneToneLabel')}<Input aria-label={t('ecommerce:fields.sceneToneAria')} value={value.style.sceneTone} maxLength={100} disabled={disabled} placeholder={t('ecommerce:fields.sceneTonePlaceholder')} onChange={event => onChange({ ...value, style: { ...value.style, sceneTone: event.target.value } })} /></label>
    <label>{t('ecommerce:fields.tagsLabel')}<Select mode="tags" aria-label={t('ecommerce:fields.tagsAria')} value={value.tags} disabled={disabled} maxCount={30} tokenSeparators={['\uff0c', ',']} placeholder={t('ecommerce:fields.tagsPlaceholder')} options={suiteStyleTagOptions(value.subcategory)}
      onChange={tags => onChange({ ...value, tags: [...new Set(tags.map((tag: string) => tag.trim()).filter(Boolean))] })} /></label>
    <p className="suite-muted">{t('ecommerce:fields.tagsHint')}</p>
    <div className="suite-fact-heading"><strong>{t('ecommerce:fields.factsHeading')}</strong><Button size="small" disabled={disabled || value.facts.length >= 50} onClick={() => addFact('dimension')}>{t('ecommerce:fields.addDimension')}</Button><Button size="small" disabled={disabled || value.facts.length >= 50} onClick={() => addFact('feature')}>{t('ecommerce:fields.addFeature')}</Button></div>
    {value.facts.map(fact => <div className="suite-fact" key={fact.id}>
      <Input aria-label={t('ecommerce:fields.factNameAria')} value={fact.name} disabled={disabled} maxLength={100} placeholder={t('ecommerce:fields.factNamePlaceholder')} onChange={event => setFact(fact.id, { name: event.target.value, originalText: `${event.target.value} ${fact.value}${'unit' in fact ? fact.unit : ''}` })} />
      {fact.kind === 'dimension' ? <>
        <Input aria-label={t('ecommerce:fields.factSubjectAria')} placeholder={t('ecommerce:fields.factSubjectPlaceholder')} value={fact.subject} maxLength={60} onChange={event => setFact(fact.id, { subject: event.target.value })} />
        <Select aria-label={t('ecommerce:fields.factAxisAria')} value={fact.axis} options={axisOptions} onChange={axis => setFact(fact.id, { axis })} />
        <InputNumber aria-label={t('ecommerce:fields.factValueAria')} min={0.01} placeholder={t('ecommerce:fields.factValuePlaceholder')} value={fact.value > 0 ? fact.value : null} onChange={number => setFact(fact.id, { value: number ?? 0, originalText: `${fact.name} ${number ?? 0}${fact.unit}` })} />
        <Select aria-label={t('ecommerce:fields.factUnitAria')} value={fact.unit} options={['cm', 'm', 'mm', 'in', 'ft'].map(unit => ({ value: unit }))} onChange={unit => setFact(fact.id, { unit, originalText: `${fact.name} ${fact.value}${unit}` })} />
      </> : <Input aria-label={t('ecommerce:fields.factFeatureAria')} placeholder={t('ecommerce:fields.factFeaturePlaceholder')} value={String(fact.value)} maxLength={200} onChange={event => setFact(fact.id, { value: event.target.value, originalText: `${fact.name} ${event.target.value}` })} />}
      <Checkbox checked={fact.confirmed} disabled={disabled || (!fact.confirmed && !isSuiteFactReady({ ...fact, confirmed: true }))} onChange={event => setFact(fact.id, { confirmed: event.target.checked, originalText: `${fact.name} ${fact.value}${'unit' in fact ? fact.unit : ''}` })}><span title={isSuiteFactReady({ ...fact, confirmed: true }) ? undefined : t('ecommerce:fields.enableFactTooltip')}>{isSuiteFactReady({ ...fact, confirmed: true }) ? t('ecommerce:fields.enableFact') : t('ecommerce:fields.enableFactIncomplete')}</span></Checkbox>
      <Button type="text" danger disabled={disabled} onClick={() => onChange({ ...value, facts: value.facts.filter(item => item.id !== fact.id) })}>{t('common:actions.delete')}</Button>
    </div>)}
    <div className="suite-fact-heading"><strong>{t('ecommerce:fields.slotsHeading')}</strong></div>
    {value.slots.map(slot => <Checkbox key={slot.id} checked={slot.enabled} disabled={disabled || (value.platform === 'amazon' && slot.kind === 'main')}
      onChange={event => onChange({ ...value, slots: value.slots.map(item => item.id === slot.id ? { ...item, enabled: event.target.checked } : item) })}>{suiteSlotLabel(slot)}</Checkbox>)}
  </fieldset>
}
