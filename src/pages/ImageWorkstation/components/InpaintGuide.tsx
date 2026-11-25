import { useTranslation } from 'react-i18next'

type InpaintMode = 'remove' | 'repaint'

const STEP_KEYS = {
  remove: [
    { step: 1, key: 'inpaintGuide.steps.remove.step1' },
    { step: 2, key: 'inpaintGuide.steps.remove.step2' },
    { step: 3, key: 'inpaintGuide.steps.remove.step3' },
  ],
  repaint: [
    { step: 1, key: 'inpaintGuide.steps.repaint.step1' },
    { step: 2, key: 'inpaintGuide.steps.repaint.step2' },
    { step: 3, key: 'inpaintGuide.steps.repaint.step3' },
  ],
} as const satisfies Record<InpaintMode, readonly { step: 1 | 2 | 3; key: string }[]>

const STATUS_KEYS = {
  remove: {
    1: 'inpaintGuide.status.remove.1',
    2: 'inpaintGuide.status.remove.2',
    3: 'inpaintGuide.status.remove.3',
  },
  repaint: {
    1: 'inpaintGuide.status.repaint.1',
    2: 'inpaintGuide.status.repaint.2',
    3: 'inpaintGuide.status.repaint.3',
  },
} as const satisfies Record<InpaintMode, Record<1 | 2 | 3, string>>

const STEP_LABEL_KEYS = {
  remove: 'inpaintGuide.stepLabels.remove',
  repaint: 'inpaintGuide.stepLabels.repaint',
} as const satisfies Record<InpaintMode, string>

/** 涂抹类工具共用的步骤引导：让「先涂抹、再补充、后生成」成为可见路径。 */
export default function InpaintGuide({ mode, step }: { mode: InpaintMode; step: 1 | 2 | 3 }) {
  const { t } = useTranslation('workstation')
  return (
    <div className="workstation-inpaint-guide">
      <ol className="workstation-inpaint-steps" aria-label={t(STEP_LABEL_KEYS[mode])}>
        {STEP_KEYS[mode].map((item) => (
          <li
            key={item.step}
            className={`workstation-inpaint-step${step === item.step ? ' is-current' : ''}${step > item.step ? ' is-complete' : ''}`}
            aria-current={step === item.step ? 'step' : undefined}
          >
            <span className="workstation-inpaint-step-index" aria-hidden="true">{item.step}</span>
            <span>{t(item.key)}</span>
          </li>
        ))}
      </ol>
      <p className="workstation-inpaint-guide-status" role="status" aria-live="polite">{t(STATUS_KEYS[mode][step])}</p>
    </div>
  )
}
