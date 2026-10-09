import { useEffect, useRef, useState } from 'react'
import { TagOutlined } from '@ant-design/icons'
import { Button, Input, Space } from 'antd'
import { formatCreditPrice, type BillingCatalog, type PaymentProvider } from '@shared/billing'
import { normalizeCreditDiscountCode, type CreditDiscount, type CreditDiscountPreview } from '@shared/credit-discounts'
import { previewCreditDiscount } from '@/services/api/billing'
import { useUserStore } from '@/store/useUserStore'

const DISCOUNT_SUCCESS = '#34d399'
const DISCOUNT_ERROR = '#e07a6e'
const FORMAT_ERROR = '折扣代码仅支持 1–14 位字母或数字'
const CHANNEL_CHANGED = '付款方式已更换，请重新验证。'

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

function savingsText(result: CreditDiscountPreview) {
  const bps = result.packs.find(item => item.available && item.discount)?.discount?.percentBps ?? 0
  const rounded = Math.round(bps / 10) / 10
  const label = Number.isInteger(rounded) ? String(rounded) : String(rounded)
  return `太棒了！你节省了 ${label}%！最终金额以结账页为准。`
}

function panelNotice(error: unknown, fallback: string) {
  const text = error instanceof Error ? error.message : fallback
  return text === FORMAT_ERROR ? '折扣代码格式无效：仅支持 1-14 位大写字母或数字。' : text
}

/** 报价只存在当前充值会话。展开状态由父组件保留；切换通道时保留已输入代码，只有已验证报价才清空并提示。 */
export default function CreditPackPurchase({ owner, catalog, provider, providerLabel, busy, expanded, onExpand, onPurchase }: Props) {
  const [draft, setDraft] = useState('')
  const [checking, setChecking] = useState(false)
  const [preview, setPreview] = useState<CreditDiscountPreview>()
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string }>()
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
      setNotice({ type: 'error', text: CHANNEL_CHANGED })
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
    catch (error) { setNotice({ type: 'error', text: panelNotice(error, '折扣代码格式无效：仅支持 1-14 位大写字母或数字。') }); return }
    if (!code) { setNotice({ type: 'error', text: '请输入折扣代码。' }); return }
    const request = version.current, abort = new AbortController()
    controller.current = abort; setChecking(true); setNotice(undefined)
    try {
      const result = await previewCreditDiscount(provider, code, catalog.currency, owner, abort.signal)
      if (!current() || request !== version.current || abort.signal.aborted) return
      if (result.provider !== provider || result.currency !== catalog.currency || result.code !== code
        || result.packs.some(item => catalog.packs.find(pack => pack.id === item.packId)?.amount !== item.amount))
        throw new Error('充值信息已更新，请重新验证折扣代码')
      if (!result.packs.some(item => item.available && item.discount)) {
        setNotice({ type: 'error', text: result.packs.find(item => item.message)?.message ?? '此折扣代码不适用于当前套餐' }); return
      }
      setDraft(result.code); setPreview(result)
      setNotice({ type: 'success', text: savingsText(result) })
    } catch (error) {
      if (current() && request === version.current && !abort.signal.aborted)
        setNotice({ type: 'error', text: panelNotice(error, '暂时无法验证这个折扣代码，请稍后重试。') })
    } finally { if (current() && request === version.current) setChecking(false) }
  }
  const purchase = async (pack: Pack, discount?: CreditDiscount) => {
    if (unverified || checking) { setNotice({ type: 'error', text: '请先点击验证。' }); return }
    const request = version.current
    try { await onPurchase(pack, discount) }
    catch (error) {
      if (!current() || request !== version.current) return
      if (!discount && !draft.trim()) return
      invalidate(); setNotice({ type: 'error', text: error instanceof Error ? error.message : '充值失败，请重新验证优惠' })
    }
  }
  return <Space direction="vertical" size={12} style={{ width: '100%' }}>
    {catalog.providers.length ? <>
      {!expanded ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>有折扣代码吗？</span>
        <Button size="small" icon={<TagOutlined />} onClick={onExpand}>应用折扣代码</Button>
      </div> : <>
        <Space.Compact style={{ width: '100%' }}>
          <Input aria-label="折扣代码" placeholder="折扣代码" value={draft} maxLength={14} autoFocus autoComplete="off"
            autoCapitalize="characters" spellCheck={false} disabled={Boolean(busy)} status={notice?.type === 'error' ? 'error' : undefined}
            onChange={event => { invalidate(); setDraft(event.target.value.toUpperCase()); setNotice(undefined) }}
            onPressEnter={() => { if (!checking && !busy) void apply() }} />
          <Button autoInsertSpace={false} loading={checking} disabled={Boolean(busy)} onClick={() => void apply()}>验证</Button>
        </Space.Compact>
        {notice ? <p style={{ margin: 0, fontSize: 14, color: notice.type === 'error' ? DISCOUNT_ERROR : DISCOUNT_SUCCESS }}>{notice.text}</p> : null}
      </>}
    </> : null}
    {catalog.packs.map(pack => {
      const offer = quote?.packs.find(item => item.packId === pack.id)
      const discount = offer?.available && offer.discount ? offer.discount : undefined
      return <div key={pack.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
        <span><strong>{pack.name} · {pack.credits} 积分</strong><br />
          {discount ? <><del>{formatCreditPrice(pack.amount, catalog.currency)}</del>{' '}<strong>预计 {formatCreditPrice(discount.payableAmount, catalog.currency)}</strong>
            <small style={{ display: 'block' }}>优惠 {discount.percentBps / 100}%</small></> : formatCreditPrice(pack.amount, catalog.currency)}
          {offer && !offer.available ? <small style={{ display: 'block' }}>{offer.message}</small> : null}
          {catalog.providers.length > 0 && !pack.providers.includes(provider) ? <small style={{ display: 'block' }}>此套餐暂不支持 {providerLabel}{catalog.providers.length > 1 ? '，可切换付款方式' : ''}</small> : null}
        </span>
        <Button type="primary" disabled={!pack.providers.includes(provider) || catalog.paymentBlocked || Boolean(busy) || checking}
          loading={busy === pack.id} onClick={() => void purchase(pack, discount)}>{offer && !discount ? '按原价购买' : '购买'}</Button>
      </div>
    })}
  </Space>
}
