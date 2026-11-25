import { useEffect, useRef, useState } from 'react'
import { TagOutlined } from '@ant-design/icons'
import { Button, Input, Space } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatCreditPrice, type BillingCatalog, type PaymentProvider } from '@shared/billing'
import { normalizeCreditDiscountCode, type CreditDiscount, type CreditDiscountPreview } from '@shared/credit-discounts'
import { i18n } from '@/i18n'
import { translateApiError } from '@/i18n/apiErrors'
import zhCredits from '@/i18n/locales/zh-CN/credits.json'
import { previewCreditDiscount } from '@/services/api/billing'
import type { ApiError } from '@/services/api/client'
import { useUserStore } from '@/store/useUserStore'

const DISCOUNT_SUCCESS = '#34d399'
const DISCOUNT_ERROR = '#e07a6e'

type Pack = BillingCatalog['packs'][number]
interface Props {
  owner: string
  catalog: BillingCatalog
  provider: PaymentProvider
  providerLabel: string
  busy?: string
  expanded: boolean
  onExpand: () => void
  onPurchase: (pack: Pack, discount?: CreditDiscount) => Promise<void>
}

function savingsPercent(result: CreditDiscountPreview) {
  const bps = result.packs.find(item => item.available && item.discount)?.discount?.percentBps ?? 0
  const rounded = Math.round(bps / 10) / 10
  return String(rounded)
}

function panelNotice(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === zhCredits.discount.formatError) {
    return i18n.t('credits:discount.formatInvalid')
  }
  const apiError = error as ApiError | undefined
  return translateApiError({
    code: apiError?.code,
    extra: apiError?.extra,
    message: error instanceof Error ? error.message : undefined,
    fallback,
  })
}

/** Session-scoped promo quote; expansion state lives in parent and switching payment method keeps code while clearing verified quotes. */
export default function CreditPackPurchase({ owner, catalog, provider, providerLabel, busy, expanded, onExpand, onPurchase }: Props) {
  const { t } = useTranslation('credits')
  const [draft, setDraft] = useState('')
  const [checking, setChecking] = useState(false)
  const [preview, setPreview] = useState<CreditDiscountPreview>()
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; key?: 'savings' | 'channelChanged' | 'formatInvalid' | 'enterCode' | 'notApplicable' | 'verifyFirst' | 'raw'; percent?: string; raw?: string }>()
  const [trackedProvider, setTrackedProvider] = useState(provider)
  const version = useRef(0)
  const controller = useRef<AbortController>()
  const mounted = useRef(true)
  const current = () => mounted.current && useUserStore.getState().userId === owner
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])
  useEffect(() => {
    version.current += 1
    controller.current?.abort()
  }, [provider])
  if (trackedProvider !== provider) {
    const hadQuote = Boolean(preview?.provider === trackedProvider && preview.packs.some(item => item.available && item.discount))
    setTrackedProvider(provider)
    setChecking(false)
    if (hadQuote) {
      setPreview(undefined)
      setNotice({ type: 'error', key: 'channelChanged' })
    } else setNotice(undefined)
  }
  const invalidate = () => {
    version.current++; controller.current?.abort(); setChecking(false); setPreview(undefined)
  }
  const quote = preview?.provider === provider ? preview : undefined
  const unverified = Boolean(draft.trim()) && quote?.code !== draft.trim().toUpperCase()
  const apply = async () => {
    invalidate()
    let code: string
    try { code = normalizeCreditDiscountCode(draft) }
    catch (error) { setNotice({ type: 'error', key: 'raw', raw: panelNotice(error, t('discount.formatInvalid')) }); return }
    if (!code) { setNotice({ type: 'error', key: 'enterCode' }); return }
    const request = version.current, abort = new AbortController()
    controller.current = abort; setChecking(true); setNotice(undefined)
    try {
      const result = await previewCreditDiscount(provider, code, catalog.currency, owner, abort.signal)
      if (!current() || request !== version.current || abort.signal.aborted) return
      if (result.provider !== provider || result.currency !== catalog.currency || result.code !== code
        || result.packs.some(item => catalog.packs.find(pack => pack.id === item.packId)?.amount !== item.amount)) {
        setNotice({ type: 'error', key: 'raw', raw: t('discount.catalogUpdated') })
        return
      }
      if (!result.packs.some(item => item.available && item.discount)) {
        const msg = result.packs.find(item => item.message)?.message
        setNotice({
          type: 'error',
          key: 'raw',
          raw: msg ? translateApiError({ message: msg, fallback: t('discount.notApplicable') }) : t('discount.notApplicable'),
        })
        return
      }
      setDraft(result.code); setPreview(result)
      setNotice({ type: 'success', key: 'savings', percent: savingsPercent(result) })
    } catch (error) {
      if (current() && request === version.current && !abort.signal.aborted)
        setNotice({ type: 'error', key: 'raw', raw: panelNotice(error, t('discount.verifyUnavailable')) })
    } finally { if (current() && request === version.current) setChecking(false) }
  }
  const purchase = async (pack: Pack, discount?: CreditDiscount) => {
    if (unverified || checking) { setNotice({ type: 'error', key: 'verifyFirst' }); return }
    const request = version.current
    try { await onPurchase(pack, discount) }
    catch (error) {
      if (!current() || request !== version.current) return
      if (!discount && !draft.trim()) return
      invalidate()
      setNotice({ type: 'error', key: 'raw', raw: panelNotice(error, t('discount.purchaseFailed')) })
    }
  }
  const noticeText = notice
    ? notice.key === 'savings'
      ? t('discount.savings', { percent: notice.percent ?? '0' })
      : notice.key && notice.key !== 'raw'
        ? t(`discount.${notice.key}`)
        : notice.raw
    : undefined
  return <Space direction="vertical" size={12} style={{ width: '100%' }}>
    {catalog.providers.length ? <>
      {!expanded ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>{t('discount.hasPromoPrompt')}</span>
        <Button size="small" icon={<TagOutlined />} onClick={onExpand}>{t('discount.usePromo')}</Button>
      </div> : <>
        <Space.Compact style={{ width: '100%' }}>
          <Input aria-label={t('discount.promoAria')} placeholder={t('discount.promoPlaceholder')} value={draft} maxLength={14} autoFocus autoComplete="off"
            autoCapitalize="characters" spellCheck={false} disabled={Boolean(busy)} status={notice?.type === 'error' ? 'error' : undefined}
            onChange={event => { invalidate(); setDraft(event.target.value.toUpperCase()); setNotice(undefined) }}
            onPressEnter={() => { if (!checking && !busy) void apply() }} />
          <Button autoInsertSpace={false} loading={checking} disabled={Boolean(busy)} onClick={() => void apply()}>{t('discount.verifyButton')}</Button>
        </Space.Compact>
        {noticeText ? <p style={{ margin: 0, fontSize: 14, color: notice?.type === 'error' ? DISCOUNT_ERROR : DISCOUNT_SUCCESS }}>{noticeText}</p> : null}
      </>}
    </> : null}
    {catalog.packs.map(pack => {
      const offer = quote?.packs.find(item => item.packId === pack.id)
      const discount = offer?.available && offer.discount ? offer.discount : undefined
      const packName = t(`packs.${pack.id}` as never, { defaultValue: pack.name })
      return <div key={pack.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
        <span><strong>{t('discount.packTitle', { name: packName, credits: pack.credits })}</strong><br />
          {discount ? <><del>{formatCreditPrice(pack.amount, catalog.currency)}</del>{' '}<strong>{t('discount.estimatedPrice', { price: formatCreditPrice(discount.payableAmount, catalog.currency) })}</strong>
            <small style={{ display: 'block' }}>{t('discount.discountPercent', { percent: discount.percentBps / 100 })}</small></> : formatCreditPrice(pack.amount, catalog.currency)}
          {offer && !offer.available ? <small style={{ display: 'block' }}>{translateApiError({ message: offer.message, fallback: t('discount.notApplicable') })}</small> : null}
          {catalog.providers.length > 0 && !pack.providers.includes(provider) ? <small style={{ display: 'block' }}>{t('discount.providerUnsupported', { provider: providerLabel })}{catalog.providers.length > 1 ? t('discount.providerSwitchHint') : ''}</small> : null}
        </span>
        <Button type="primary" disabled={!pack.providers.includes(provider) || catalog.paymentBlocked || Boolean(busy) || checking}
          loading={busy === pack.id} onClick={() => void purchase(pack, discount)}>{offer && !discount ? t('discount.buyOriginal') : t('discount.buy')}</Button>
      </div>
    })}
  </Space>
}
