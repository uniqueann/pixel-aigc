type InpaintMode = 'remove' | 'repaint'

const STEPS: Record<InpaintMode, readonly { step: 1 | 2 | 3; label: string }[]> = {
  remove: [
    { step: 1, label: '涂抹区域' },
    { step: 2, label: '补充说明（可选）' },
    { step: 3, label: '生成' },
  ],
  repaint: [
    { step: 1, label: '涂抹区域' },
    { step: 2, label: '填写描述' },
    { step: 3, label: '生成' },
  ],
}

const STATUS: Record<InpaintMode, Record<1 | 2 | 3, string>> = {
  remove: {
    1: '先在左侧图片上涂抹要消除的区域',
    2: '已涂抹 · 可补充背景描述，留空也能生成',
    3: '蒙版已就绪，只会修改涂抹区域，可以生成',
  },
  repaint: {
    1: '先在左侧图片上涂抹要重绘的区域',
    2: '已涂抹 · 请填写重绘描述',
    3: '蒙版与描述已就绪，可以生成',
  },
}

const STEP_LABEL: Record<InpaintMode, string> = {
  remove: '消除步骤',
  repaint: '重绘步骤',
}

/** 涂抹类工具共用的步骤引导：让「先涂抹、再补充、后生成」成为可见路径。 */
export default function InpaintGuide({ mode, step }: { mode: InpaintMode; step: 1 | 2 | 3 }) {
  return (
    <div className="workstation-inpaint-guide">
      <ol className="workstation-inpaint-steps" aria-label={STEP_LABEL[mode]}>
        {STEPS[mode].map((item) => (
          <li
            key={item.step}
            className={`workstation-inpaint-step${step === item.step ? ' is-current' : ''}${step > item.step ? ' is-complete' : ''}`}
            aria-current={step === item.step ? 'step' : undefined}
          >
            <span className="workstation-inpaint-step-index" aria-hidden="true">{item.step}</span>
            <span>{item.label}</span>
          </li>
        ))}
      </ol>
      <p className="workstation-inpaint-guide-status" role="status" aria-live="polite">{STATUS[mode][step]}</p>
    </div>
  )
}
