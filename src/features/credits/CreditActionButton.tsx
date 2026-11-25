import { Button, type ButtonProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { creditQuoteBlocked, creditQuoteLabel, type CreditQuote } from './quotes'
import { useUserStore } from '@/store/useUserStore'
import { openCreditRecharge } from '@/services/api/billing'
import './creditActions.css'

interface Props extends ButtonProps {
  quote?: CreditQuote
}

/** Single-price action button; disabled whenever the quote is loading or unavailable. */
export default function CreditActionButton({ quote, children, disabled, className, ...props }: Props) {
  useTranslation('credits')
  return <Button {...props} className={`credit-action-button ${className ?? ''}`} disabled={disabled || creditQuoteBlocked(quote)}>
    <span>{children}{quote ? ` · ${creditQuoteLabel(quote)}` : null}</span>
  </Button>
}

export function CreditQuoteNotice({ quote, onRetry }: { quote: CreditQuote; onRetry?: () => void }) {
  const { t } = useTranslation('credits')
  return quote.status === 'unavailable' ? <p className="credit-quote-notice" role="alert">
    {t('quotes.unavailableNotice')}{onRetry ? <Button size="small" type="link" onClick={onRetry}>{t('quotes.reloadQuote')}</Button> : null}
  </p> : null
}

export function CreditSettlementHint({ quote }: { quote: CreditQuote }) {
  const { t } = useTranslation('credits')
  return quote.status === 'ready' ? <p className="credit-quote-notice">
    {t('quotes.settlementHint')}{quote.maximum || quote.estimatedFree ? t('quotes.reconfirmHint') : ''}
  </p> : null
}

export function CreditBalanceNotice({ quote }: { quote: CreditQuote }) {
  const { t } = useTranslation('credits')
  const owner = useUserStore(state => state.userId)
  const balance = useUserStore(state => state.credits)
  const loaded = useUserStore(state => state.creditsLoaded)
  return owner && loaded && quote.status === 'ready' && quote.credits > balance ? <p className="credit-quote-notice" role="status">
    {t('quotes.insufficientBalance', {
      maxWord: quote.maximum ? t('quotes.maxWord') : '',
      required: quote.credits,
      balance,
    })}<Button size="small" type="link" onClick={openCreditRecharge}>{t('quotes.goRecharge')}</Button>
  </p> : null
}
