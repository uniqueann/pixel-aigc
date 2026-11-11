import { MASK_PAINT_CSS } from '@shared/smart-select'
import { ProductSilhouette } from './exampleArt'

/**
 * 消除 / 重绘未上传时的教学示意：三帧讲清「涂抹 → 生成」这一条路径。
 * 与智能编辑、重新打光共用同一套虚线框与主色语法，不伪造生成结果。
 *
 * 两处约定必须与画布一致：涂抹蒙版用 MASK_PAINT_CSS（画布里的真实红色），
 * 生成物用主色。否则示例教的手势和真实反馈对不上。
 */
export type InpaintExampleMode = 'remove' | 'repaint'

export default function InpaintExample({ mode }: { mode: InpaintExampleMode }) {
  const isRemove = mode === 'remove'
  return (
    <details className={`tool-example concept-example inpaint-example is-${mode}`} open>
      <summary>示例</summary>
      <div className="tool-example-row">
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="原图示意：商品旁边有一处杂物">
              <Backdrop />
              <Floor />
              <Clutter />
              <ProductSilhouette />
            </svg>
          </div>
          <figcaption>原图</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg
              viewBox="0 0 112 112"
              role="img"
              aria-label={isRemove
                ? '涂抹示意：蒙版盖住杂物，商品保持原样'
                : '涂抹并描述示意：蒙版盖住杂物，气泡里的描述只作用在这块区域'}
            >
              <Backdrop />
              <Floor />
              <Clutter />
              <Mask />
              <BrushRing />
              {isRemove ? null : <><DescriptionBubble /><DescriptionLeader /></>}
              <ProductSilhouette />
            </svg>
          </div>
          <figcaption>{isRemove ? '涂抹' : '涂抹 + 描述'}</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg
              viewBox="0 0 112 112"
              role="img"
              aria-label={isRemove
                ? '补背景示意：杂物消失，虚线框标出由 AI 补齐的背景'
                : '按描述生成示意：蒙版位置变成描述里的事物'}
            >
              <Backdrop />
              {isRemove ? <><Floor /><Refilled /></> : <><Floor /><GeneratedThing /><MaskAreaRing /></>}
              <ProductSilhouette />
            </svg>
          </div>
          <figcaption>{isRemove ? '背景被补齐' : '按描述生成'}</figcaption>
        </figure>
      </div>
      <p className="concept-example-note">
        {isRemove
          ? '红色 = 涂抹的蒙版；虚线框 = AI 补齐的背景，其余保持原样。'
          : '红色 = 涂抹区域；气泡 = 只作用在这块区域的描述，其余保持原样。'}
      </p>
    </details>
  )
}

function Backdrop() {
  return (
    <rect
      x="10"
      y="12"
      width="92"
      height="88"
      rx="8"
      fill="var(--color-surface-2)"
      stroke="var(--color-border)"
      strokeWidth="1.4"
    />
  )
}

/** 台面线：三帧位置固定，补齐后仍连续穿过空缺，才读得出「背景接上了」。 */
function Floor() {
  return (
    <path
      d="M18 86h76"
      fill="none"
      stroke="var(--color-text-muted)"
      strokeWidth="1.2"
      strokeLinecap="round"
      opacity=".45"
    />
  )
}

/** 要处理的杂物：一团揉皱的纸，和商品形成「主体 / 干扰物」的对比。 */
function Clutter() {
  return (
    <>
      <path
        d="M22 85.5c-2.2-2.6-2.8-6-1.4-8.6 1.4-2.6 4.2-4 6.9-3.3 2.7.6 4.4 3 4.2 5.6-.2 2.6-2.2 4.7-5 5.5-1.6.5-3.3.6-4.7.8Z"
        fill="var(--color-text-muted)"
        opacity=".5"
      />
      <path
        d="M24 81.5c1.8-.6 3.4-1.8 4.6-3.4M25.5 84.5c1.6-.4 3-1.2 4.2-2.4"
        fill="none"
        stroke="var(--color-surface-2)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity=".8"
      />
    </>
  )
}

/** 涂抹蒙版：形状刻意不规整，读得出是画笔涂的而不是框选的。 */
function Mask() {
  return (
    <path
      d="M20.6 82.8c-2.6-2.6-3.4-6.2-1.9-8.8 1.4-2.4 4.2-3.6 6.8-2.8 2.4.8 4 3 4.6 5.6.6 2.4-.4 4.6-2.4 5.8-2.4 1.4-5.2 1.2-7.1.2Z"
      fill={MASK_PAINT_CSS}
    />
  )
}

/** 光标环：说明这一步是在画布上用画笔涂的。 */
function BrushRing() {
  return (
    <>
      <circle cx="27.5" cy="78" r="4.4" fill="none" stroke="var(--color-text)" strokeWidth="1" opacity=".45" />
      <circle cx="27.5" cy="78" r="1.2" fill="var(--color-text)" opacity=".5" />
    </>
  )
}

/** 描述气泡：112px 内写不下中文，用三条短横线表示「这里写了描述」，内容交给图注。 */
function DescriptionBubble() {
  return (
    <>
      <rect
        x="12"
        y="13"
        width="32"
        height="18"
        rx="5"
        fill="var(--color-accent-soft)"
        stroke="var(--color-accent-text)"
        strokeWidth="1.3"
      />
      <path
        d="M18 19h20M18 24h20M18 29h12"
        fill="none"
        stroke="var(--color-accent-text)"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity=".85"
      />
    </>
  )
}

/** 气泡指向蒙版的引线：讲清「描述只对这一块生效」这条因果。 */
function DescriptionLeader() {
  return (
    <path
      d="M28 31c-.6 8-.4 14 0 20"
      fill="none"
      stroke="var(--color-accent-text)"
      strokeWidth="1"
      strokeDasharray="2 3"
      strokeLinecap="round"
      opacity=".55"
    />
  )
}

/** 消除的结果：杂物没了，台面线连续，虚线框 + 十字标出被 AI 补齐的位置。 */
function Refilled() {
  return (
    <>
      <rect
        x="16"
        y="65"
        width="23"
        height="21"
        rx="4"
        fill="none"
        stroke="var(--color-accent-text)"
        strokeWidth="1.4"
        strokeDasharray="3.5 3.5"
      />
      <path
        d="M27.5 72v7M24 75.5h7"
        fill="none"
        stroke="var(--color-accent-text)"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity=".75"
      />
    </>
  )
}

/** 重绘的结果：同一个位置长出了描述里的事物，用主色明确「这是新生成的」。 */
function GeneratedThing() {
  return (
    <>
      <path
        d="M24.6 71.4c0 1.5-1.7 2.4-1.7 5.6 0 3.4 1.8 6.4 5.2 6.4s5.2-3 5.2-6.4c0-3.2-1.7-4.1-1.7-5.6Z"
        fill="var(--color-accent-soft)"
        stroke="var(--color-accent-text)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M24.3 71.4h7.6" fill="none" stroke="var(--color-accent-text)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M28.1 71.4V64" fill="none" stroke="var(--color-accent-text)" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="28.1" cy="61.2" r="2.6" fill="var(--color-accent-text)" opacity=".7" />
    </>
  )
}

/** 生成区域提示：与「虚线框 = AI 作用区域」的既有语法一致。 */
function MaskAreaRing() {
  return (
    <rect
      x="17"
      y="57"
      width="22"
      height="29"
      rx="4"
      fill="none"
      stroke="var(--color-accent-text)"
      strokeWidth="1.2"
      strokeDasharray="3 3"
      opacity=".5"
    />
  )
}
