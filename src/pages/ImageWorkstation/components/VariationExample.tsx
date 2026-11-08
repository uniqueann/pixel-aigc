import { ProductSilhouette } from './exampleArt'

/**
 * 裂变未上传时的教学示意：一张原图 → 两张场景/构图不同的变体。
 * 用示意图代替照片，避免把「换色」误当成裂变的主能力。
 */
export default function VariationExample() {
  return (
    <details className="tool-example concept-example variation-example" open>
      <summary>示例</summary>
      <div className="tool-example-row">
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="原图示意：白底商品图">
              <rect
                x="8"
                y="8"
                width="96"
                height="96"
                rx="8"
                fill="var(--color-surface)"
                stroke="var(--color-border)"
              />
              <ProductSilhouette />
            </svg>
          </div>
          <figcaption>原图</figcaption>
        </figure>
        <span className="tool-example-arrow" aria-hidden="true">→</span>
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="变体示意：保留商品，背景换成户外木桌">
              <rect
                x="8"
                y="8"
                width="96"
                height="96"
                rx="8"
                fill="var(--color-accent-soft)"
                stroke="var(--color-accent-text)"
                strokeWidth="1.4"
                strokeDasharray="4 4"
              />
              <circle cx="82" cy="28" r="7" fill="var(--color-accent-text)" opacity=".45" />
              <path d="M8 76h96v28H8z" fill="var(--color-surface-2)" opacity=".85" />
              <path
                d="M18 68c4-7 10-11 18-12"
                fill="none"
                stroke="var(--color-accent-text)"
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity=".55"
              />
              <ProductSilhouette />
            </svg>
          </div>
          <figcaption>换场景</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="变体示意：保留商品，构图改为俯拍留白">
              <rect
                x="8"
                y="8"
                width="96"
                height="96"
                rx="8"
                fill="var(--color-accent-soft)"
                stroke="var(--color-accent-text)"
                strokeWidth="1.4"
                strokeDasharray="4 4"
              />
              <rect x="14" y="18" width="26" height="26" rx="5" fill="var(--color-surface-2)" />
              <circle cx="86" cy="76" r="11" fill="var(--color-accent-text)" opacity=".18" />
              <g transform="translate(12 10) scale(.86)">
                <ProductSilhouette />
              </g>
            </svg>
          </div>
          <figcaption>换构图</figcaption>
        </figure>
      </div>
      <p className="concept-example-note">示意：保留商品主体，改变场景或构图；一次可生成多张变体。</p>
    </details>
  )
}
