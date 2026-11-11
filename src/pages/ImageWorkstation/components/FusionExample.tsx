import { ProductSilhouette } from './exampleArt'

/**
 * 融合未上传时的教学示意：两路输入各取所需 → 一张合成结果。
 * 与消除、重绘、裂变共用同一套卡片与图注语法，不伪造生成结果。
 *
 * 融合最容易误解的是「商品不变、场景只给背景」，照片画不出这条约束，
 * 所以这里用线型区分职责：实线框 = 原样保留的商品，虚线框 = 只取背景的场景。
 * 三帧里场景物件的站位固定，才能读出它始终留在背景、没有被画进商品。
 */
export default function FusionExample() {
  return (
    <details className="tool-example concept-example fusion-example" open>
      <summary>示例</summary>
      <div className="tool-example-row">
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="商品示意：单独给出的商品图，形状颜色纹理保持不变">
              <Backdrop />
              <ProductSilhouette fill="var(--color-surface)" />
              <FidelityFrame />
            </svg>
          </div>
          <figcaption>商品</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="场景示意：虚线框标出场景图只提供背景，场景里的物件不会画进商品">
              <Backdrop />
              <SceneBackdrop />
              <Floor />
              <SceneObject />
              <SceneFrame />
            </svg>
          </div>
          <figcaption>场景</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="合成示意：商品原样放进新场景，场景里的物件只留在背景">
              <Backdrop />
              <SceneBackdrop />
              <Floor />
              <SceneObject />
              <ProductSilhouette fill="var(--color-surface)" stroke="var(--color-accent-text)" strokeWidth={1.6} />
              <KeptBadge />
            </svg>
          </div>
          <figcaption>合成</figcaption>
        </figure>
      </div>
      <p className="concept-example-note">
        实线框 = 商品原样保留；虚线框 = 场景图只提供背景，场景里的物件不会画进商品。
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

/** 场景的环境暗示：几道竖向纹理，只够读出「这是另一张背景」，不画成具体照片。 */
function SceneBackdrop() {
  return (
    <g stroke="var(--color-text-muted)" strokeWidth="1" strokeLinecap="round" opacity=".28">
      <path d="M24 18v44M36 18v44M48 18v44M60 18v44M72 18v44M84 18v44M96 18v44" />
    </g>
  )
}

/** 台面线：两帧位置固定，合成后仍连续穿过，才读得出场景背景被沿用。 */
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

/** 场景里的物件：站位在两帧中不变，证明它留在背景、没被画进商品。 */
function SceneObject() {
  return (
    <g opacity=".5">
      <path d="M21 76h13l-1.6 10h-9.8Z" fill="var(--color-text-muted)" />
      <path
        d="M27.5 76c0-4.6-2.4-7.2-5.6-7.6.4 4.4 2.6 7.2 5.6 7.6Zm0 0c.2-4.4 2.6-6.8 5.4-7.2-.2 4.2-2.4 6.8-5.4 7.2Z"
        fill="none"
        stroke="var(--color-text-muted)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </g>
  )
}

/** 保真：实线框圈住商品，与「虚线 = AI 改动区域」的既有语法互斥。 */
function FidelityFrame() {
  return (
    <rect
      x="34"
      y="34"
      width="50"
      height="52"
      rx="7"
      fill="none"
      stroke="var(--color-accent-text)"
      strokeWidth="1.4"
    />
  )
}

/** 场景来源：虚线框与消除、重绘的「AI 作用区域」同语法，表示这块背景取自场景图。 */
function SceneFrame() {
  return (
    <rect
      x="16"
      y="17"
      width="80"
      height="74"
      rx="5"
      fill="none"
      stroke="var(--color-accent-text)"
      strokeWidth="1.4"
      strokeDasharray="3.5 3.5"
      opacity=".85"
    />
  )
}

/** 保真徽标：合成后仍标一次商品未变，避免把「放进场景」读成「被重画」。 */
function KeptBadge() {
  return (
    <>
      <circle cx="82" cy="34" r="6" fill="var(--color-accent-text)" />
      <path
        d="M79.2 34l2 2.1 3.7-4"
        fill="none"
        stroke="var(--color-on-accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  )
}
