import { useId, useState } from 'react'
import { billingExplanationCopy } from './billingCopy'

export default function BillingExplanation({
  freeBgRemoveRemaining,
  freeBgRemoveMonth,
}: {
  freeBgRemoveRemaining: number
  freeBgRemoveMonth: string
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonId = useId()
  const copy = billingExplanationCopy({ freeBgRemoveRemaining, freeBgRemoveMonth })
  return (
    <section className="billing-explanation">
      <button
        type="button"
        id={buttonId}
        className="billing-explanation-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(current => !current)}
      >
        <span className="billing-explanation-summary">{copy.summary}</span>
        <span className="billing-explanation-action">
          {open ? '收起计费明细' : '查看计费明细'}
          <span aria-hidden="true" className={open ? 'billing-explanation-chevron is-open' : 'billing-explanation-chevron'} />
        </span>
      </button>
      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!open} className="billing-explanation-panel">
        {copy.groups.map(group => (
          <section key={group.title} className="billing-explanation-group">
            <h3>{group.title}</h3>
            <ul>
              {group.items.map(item => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
