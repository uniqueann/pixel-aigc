import { useId } from 'react'
import { ProductSilhouette } from './exampleArt'
import { OUTPAINT_FRAME_COLOR } from '../utils/outpaintGeometry'

/**
 * 扩图未上传时的教学示意：原图 → 往外拖绿框扩画布 → 框外补出背景。
 * 与消除、融合共用同一套卡片与图注语法，不伪造生成结果。
 *
 * 两条约定必须与画布一致：
 * 1. 边框与控制点用 OUTPAINT_FRAME_COLOR，和真实画布同色；
 * 2. 商品三帧位置与大小完全相同 —— 扩图只动画布边缘，不会缩放或移动原图像素。
 */

/** 三帧共用的商品变换：底边落在台面线上，且完整落在原图边界内。 */
const PRODUCT_TRANSFORM = 'translate(56 76) scale(.82) translate(-57.5 -79)'
/** 背景竖纹的栅格与顶端：两帧取同一序列，补齐带才和原图内部接得上。 */
const STRIPE_TOP = 14
const STRIPE_ORIGIN = 16
const STRIPE_STEP = 12
/** 原图像素边界：框外才是 AI 要补的区域。 */
const PHOTO = { x: 20, y: 24, width: 72, height: 64 }
/** 目标画布：左右、上下对称外扩，与原图同心。 */
const TARGET = { x: 8, y: 14, width: 96, height: 84 }
/** 台面线：三帧同一高度，补齐后仍连续穿过，才读得出「背景接上了」。 */
const FLOOR_Y = 76

export default function OutpaintExample() {
  return (
    <details className="tool-example concept-example outpaint-example" open>
      <summary>示例</summary>
      <div className="tool-example-row">
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="原图示意：画面到这里就截止了，实线框外没有内容">
              <PhotoCard />
            </svg>
          </div>
          <figcaption>原图</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg
              viewBox="0 0 112 112"
              role="img"
              aria-label="拖拽示意：绿色虚线框向外拖，框外的浅绿区域就是要由 AI 补齐的部分"
            >
              <rect
                x={TARGET.x}
                y={TARGET.y}
                width={TARGET.width}
                height={TARGET.height}
                rx="8"
                fill="var(--color-accent-soft)"
              />
              <PhotoCard />
              <TargetFrame />
              <DragChevrons />
              <Handles />
            </svg>
          </div>
          <figcaption>向外拖绿框</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg
              viewBox="0 0 112 112"
              role="img"
              aria-label="补齐示意：框外补出了背景，商品位置和大小没有变化"
            >
              <rect
                x={TARGET.x}
                y={TARGET.y}
                width={TARGET.width}
                height={TARGET.height}
                rx="8"
                fill="var(--color-surface-2)"
              />
              <WallStripes from={TARGET.x} to={TARGET.x + TARGET.width} />
              <Floor from={TARGET.x} to={TARGET.x + TARGET.width} />
              <Product />
              <PhotoBoundary />
              <TargetFrame faded />
            </svg>
          </div>
          <figcaption>框外补背景</figcaption>
        </figure>
      </div>
      <p className="concept-example-note">
        绿色虚线框 = 目标画布，向外拖多少就补多少；实线框 = 原图像素边界，框内原样保留。
      </p>
    </details>
  )
}

/**
 * 原图：实线细框是像素边界，框内的画面在三帧里原样沿用。
 * 纹理按全局栅格画完再裁进边界，所以拼到补齐帧时和框外新长出来的一段严丝合缝。
 */
function PhotoCard() {
  const clipId = `outpaint-photo-${useId().replace(/:/g, '')}`
  return (
    <>
      <clipPath id={clipId}>
        <rect x={PHOTO.x} y={PHOTO.y} width={PHOTO.width} height={PHOTO.height} rx="6" />
      </clipPath>
      <rect
        x={PHOTO.x}
        y={PHOTO.y}
        width={PHOTO.width}
        height={PHOTO.height}
        rx="6"
        fill="var(--color-surface-2)"
      />
      <g clipPath={`url(#${clipId})`}>
        <WallStripes from={TARGET.x} to={TARGET.x + TARGET.width} />
        <Floor from={TARGET.x} to={TARGET.x + TARGET.width} />
      </g>
      <Product />
      <rect
        x={PHOTO.x}
        y={PHOTO.y}
        width={PHOTO.width}
        height={PHOTO.height}
        rx="6"
        fill="none"
        stroke="var(--color-border-strong)"
        strokeWidth="1.4"
      />
    </>
  )
}

/**
 * 背景竖纹：固定栅格从左到右取点、顶端两帧同高。
 * 原图那圈和补齐后新长出来的那圈因此天然对齐，读得出是同一面墙。
 */
function WallStripes({ from, to }: { from: number; to: number }) {
  const columns: number[] = []
  const first = STRIPE_ORIGIN + Math.ceil((from - STRIPE_ORIGIN) / STRIPE_STEP) * STRIPE_STEP
  for (let x = first; x <= to; x += STRIPE_STEP) columns.push(x)
  return (
    <g stroke="var(--color-text-muted)" strokeWidth="1" strokeLinecap="round" opacity=".26">
      {columns.map(x => <path key={x} d={`M${x} ${STRIPE_TOP}v${FLOOR_Y - STRIPE_TOP}`} />)}
    </g>
  )
}

/** 台面线：三帧位置固定，补齐后仍连续穿过，证明背景没有断裂。 */
function Floor({ from, to }: { from: number; to: number }) {
  return (
    <path
      d={`M${from} ${FLOOR_Y}h${to - from}`}
      fill="none"
      stroke="var(--color-text-muted)"
      strokeWidth="1.2"
      strokeLinecap="round"
      opacity=".45"
    />
  )
}

/** 商品：三帧共用同一个变换，扩图不缩放也不移动原图像素。 */
function Product() {
  return (
    <g transform={PRODUCT_TRANSFORM}>
      <ProductSilhouette fill="var(--color-surface)" />
    </g>
  )
}

/**
 * 目标画布边界：虚线框与消除、重绘的「AI 作用区域」同语法。
 * 结果帧淡化保留，才能和原图实线框并置，证明「画布变大、框内没动」。
 */
function TargetFrame({ faded = false }: { faded?: boolean }) {
  return (
    <rect
      x={TARGET.x}
      y={TARGET.y}
      width={TARGET.width}
      height={TARGET.height}
      rx="8"
      fill="none"
      stroke={OUTPAINT_FRAME_COLOR}
      strokeWidth="1.6"
      strokeDasharray="4 3.5"
      opacity={faded ? 0.55 : 1}
    />
  )
}

/**
 * 原图像素边界：补齐后仍留下这条实线（淡化），才读得出「这圈是新补的、框里没动」。
 * 线不能太深，真实结果是一张连续画面，不该看起来有接缝。
 */
function PhotoBoundary() {
  return (
    <rect
      x={PHOTO.x}
      y={PHOTO.y}
      width={PHOTO.width}
      height={PHOTO.height}
      rx="6"
      fill="none"
      stroke="var(--color-border-strong)"
      strokeWidth="1.2"
      opacity=".8"
    />
  )
}

/** 控制点：与画布四角一致，说明这条边界可以直接拖。 */
function Handles() {
  const corners: Array<[number, number]> = [
    [TARGET.x, TARGET.y],
    [TARGET.x + TARGET.width, TARGET.y],
    [TARGET.x, TARGET.y + TARGET.height],
    [TARGET.x + TARGET.width, TARGET.y + TARGET.height],
  ]
  return (
    <>
      {corners.map(([cx, cy]) => (
        <rect
          key={`${cx}-${cy}`}
          x={cx - 2.2}
          y={cy - 2.2}
          width="4.4"
          height="4.4"
          rx="1.1"
          fill={OUTPAINT_FRAME_COLOR}
        />
      ))}
    </>
  )
}

/** 左右两个向外的箭头：画在新增的浅绿带里，讲清「拖的是这条边、方向朝外」。 */
function DragChevrons() {
  return (
    <g
      fill="none"
      stroke={OUTPAINT_FRAME_COLOR}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 52.5 13 56l4 3.5" />
      <path d="M95 52.5 99 56l-4 3.5" />
    </g>
  )
}
