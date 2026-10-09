import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Space } from 'antd'
import { formatCreditPrice, type BillingCatalog, type PaymentProvider } from '@shared/billing'
import { normalizeCreditDiscountCode, type CreditDiscount, type CreditDiscountPreview } from '@shared/credit-discounts'
import { previewCreditDiscount } from '@/services/api/billing'
import { useUserStore } from '@/store/useUserStore'

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

/** 由父组件按账号、通道、价格和打开状态重建，报价只存在当前充值会话。展开状态由父组件保留。 */
export default function CreditPackPurchase({ owner, catalog, provider, providerLabel, busy, expanded, onExpand, onPurchase }: Props) {
  const [draft, setDraft] = useState('')
  const [checking, setChecking] = useState(false)
  const [preview, setPreview] = useState<CreditDiscountPreview>()
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string }>()
  const version = useRef(0)
  const controller = useRef<AbortController>()
  const mounted = useRef(true)
  const current = () => mounted.current && useUserStore.getState().userId === owner
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])
  const invalidate = () => {
    version.current++; controller.current?.abort(); setChecking(false); setPreview(undefined)
  }
  const remove = () => { invalidate(); setDraft(''); setNotice(undefined) }
  const unverified = Boolean(draft.trim()) && preview?.code !== draft.trim().toUpperCase()
  const removable = Boolean(preview) || Boolean(draft.trim())
  const apply = async () => {
    invalidate()
    let code: string
    try { code = normalizeCreditDiscountCode(draft) }
    catch (error) { setNotice({ type: 'error', text: (error as Error).message }); return }
    if (!code) { setNotice({ type: 'error', text: '请输入折扣码' }); return }
    const request = version.current, abort = new AbortController()
    controller.current = abort; setChecking(true); setNotice(undefined)
    try {
      const result = await previewCreditDiscount(provider, code, catalog.currency, owner, abort.signal)
      if (!current() || request !== version.current || abort.signal.aborted) return
      if (result.provider !== provider || result.currency !== catalog.currency || result.code !== code
        || result.packs.some(item => catalog.packs.find(pack => pack.id === item.packId)?.amount !== item.amount))
        throw new Error('充值信息已更新，请重新应用折扣码')
      if (!result.packs.some(item => item.available && item.discount)) {
        setNotice({ type: 'error', text: result.packs.find(item => item.message)?.message ?? '此折扣码不适用于当前套餐' }); return
      }
      setDraft(result.code); setPreview(result)
      setNotice({ type: 'success', text: '折扣码已应用，到账积分保持不变。最终金额以结账页为准。' })
    } catch (error) {
      if (current() && request === version.current && !abort.signal.aborted)
        setNotice({ type: 'error', text: error instanceof Error ? error.message : '暂时无法验证折扣码，请稍后重试' })
    } finally { if (current() && request === version.current) setChecking(false) }
  }
  const purchase = async (pack: Pack, discount?: CreditDiscount) => {
    if (unverified || checking) { setNotice({ type: 'error', text: '请先应用或移除折扣码再购买' }); return }
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
      {!expanded ? <Button type="link" style={{ padding: 0 }} onClick={onExpand}>有折扣码？</Button> : <>
        <Space.Compact style={{ width: '100%' }}>
          <Input aria-label="折扣码" placeholder="输入折扣码" value={draft} maxLength={100} disabled={Boolean(busy)}
            onChange={event => { invalidate(); setDraft(event.target.value); setNotice(undefined) }}
            onPressEnter={() => { if (!checking && !busy) void apply() }} />
          <Button loading={checking} disabled={Boolean(busy)} onClick={() => void apply()}>应用折扣码</Button>
          {removable ? <Button autoInsertSpace={false} disabled={Boolean(busy)} onClick={remove}>移除</Button> : null}
        </Space.Compact>
        {notice ? <Alert type={notice.type} message={notice.text} /> : null}
      </>}
    </> : null}
    {catalog.packs.map(pack => {
      const offer = preview?.packs.find(item => item.packId === pack.id)
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
