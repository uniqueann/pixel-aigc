import { Button, type ButtonProps } from 'antd'
import { creditQuoteBlocked, creditQuoteLabel, type CreditQuote } from './quotes'
import { useUserStore } from '@/store/useUserStore'
import { openCreditRecharge } from '@/services/api/billing'
import './creditActions.css'

interface Props extends ButtonProps {
  quote?: CreditQuote
}

/** 所有可能创建收费任务的按钮统一展示报价，未知价格时禁止提交。 */
export default function CreditActionButton({ quote, children, disabled, className, ...props }: Props) {
  return <Button {...props} className={`credit-action-button ${className ?? ''}`} disabled={disabled || creditQuoteBlocked(quote)}>
    <span>{children}{quote ? ` · ${creditQuoteLabel(quote)}` : null}</span>
  </Button>
}

export function CreditQuoteNotice({ quote, onRetry }: { quote: CreditQuote; onRetry?: () => void }) {
  return quote.status === 'unavailable' ? <p className="credit-quote-notice" role="alert">
    报价暂不可用，请重新加载。{onRetry ? <Button size="small" type="link" onClick={onRetry}>重新加载报价</Button> : null}
  </p> : null
}

export function CreditSettlementHint({ quote }: { quote: CreditQuote }) {
  return quote.status === 'ready' ? <p className="credit-quote-notice">按实际成功结果结算，失败退积分。{quote.maximum || quote.estimatedFree ? '提交时会重新确认费用。' : ''}</p> : null
}

export function CreditBalanceNotice({ quote }: { quote: CreditQuote }) {
  const owner = useUserStore(state => state.userId)
  const balance = useUserStore(state => state.credits)
  const loaded = useUserStore(state => state.creditsLoaded)
  return owner && loaded && quote.status === 'ready' && quote.credits > balance ? <p className="credit-quote-notice" role="status">
    积分不足，本次{quote.maximum ? '最多' : ''}需要 {quote.credits} 积分，当前 {balance}。<Button size="small" type="link" onClick={openCreditRecharge}>去充值</Button>
  </p> : null
}
