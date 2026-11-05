const STEPS = [
  { step: 1, label: '涂抹区域' },
  { step: 2, label: '填写描述' },
  { step: 3, label: '生成' },
] as const

const STATUS = {
  1: '先在左侧图片上涂抹要重绘的区域',
  2: '已涂抹 · 请填写重绘描述',
  3: '蒙版与描述已就绪，可以生成',
} as const

/** 重绘上传后的三步引导，让「先涂抹、再描述、后生成」成为可见路径。 */
export default function RepaintGuide({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="workstation-repaint-guide">
      <ol className="workstation-repaint-steps" aria-label="重绘步骤">
        {STEPS.map((item) => (
          <li
            key={item.step}
            className={`workstation-repaint-step${step === item.step ? ' is-current' : ''}${step > item.step ? ' is-complete' : ''}`}
            aria-current={step === item.step ? 'step' : undefined}
          >
            <span className="workstation-repaint-step-index" aria-hidden="true">{item.step}</span>
            <span>{item.label}</span>
          </li>
        ))}
      </ol>
      <p className="workstation-repaint-guide-status" role="status" aria-live="polite">{STATUS[step]}</p>
    </div>
  )
}
