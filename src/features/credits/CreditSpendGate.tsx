import { useEffect, useRef, useState } from 'react'
import { Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import { SPEND_CONFIRM_EVENT, type SpendConfirmation } from '@/services/api/billing'
import { useUserStore } from '@/store/useUserStore'

export default function CreditSpendGate() {
  const { t } = useTranslation(['credits', 'common'])
  const owner = useUserStore(state => state.userId)
  const [pending, setPending] = useState<SpendConfirmation[]>([])
  const requests = useRef(new Set<SpendConfirmation>())
  useEffect(() => {
    const queue = requests.current
    const receive = (event: Event) => {
      const next = (event as CustomEvent<SpendConfirmation>).detail
      if (next.owner !== owner) { next.resolve(false); return }
      queue.add(next); setPending(current => [...current, next])
    }
    window.addEventListener(SPEND_CONFIRM_EVENT, receive)
    return () => { window.removeEventListener(SPEND_CONFIRM_EVENT, receive); queue.forEach(item => item.resolve(false)); queue.clear(); setPending([]) }
  }, [owner])
  const current = pending[0]
  const finish = (approved: boolean) => {
    if (current) { requests.current.delete(current); current.resolve(approved) }
    setPending(items => items.slice(1))
  }
  const toolName = current ? t(`credits:syncTools.${current.operation}` as never) : ''
  return (
    <Modal
      open={Boolean(current)}
      title={t('credits:spendGate.title', { tool: toolName })}
      okText={t('credits:spendGate.ok')}
      cancelText={t('common:actions.cancel')}
      onOk={() => finish(true)}
      onCancel={() => finish(false)}
    >
      {current ? (
        <>
          <p>
            {current.operation === 'outpaint' && current.required === 10
              ? t('credits:spendGate.outpaintRange')
              : t('credits:spendGate.fixedAmount', { required: current.required })}
          </p>
          <p>{t('credits:spendGate.balanceNote', { balance: current.balance })}</p>
        </>
      ) : null}
    </Modal>
  )
}
