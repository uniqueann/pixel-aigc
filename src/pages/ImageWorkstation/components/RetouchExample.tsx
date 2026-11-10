import { ProductSilhouette } from './exampleArt'

/**
 * 未上传时的精修教学示意：用「原图 / 精修后 / 文字与颜色不变」讲清只修什么、不动什么。
 * 与智能编辑、重新打光共用同一套虚线框与图注语法，不伪造生成结果。
 */
export default function RetouchExample() {
  return (
    <details className="tool-example concept-example retouch-example" open>
      <summary>示例</summary>
      <div className="tool-example-row">
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="原图示意：商品表面有灰尘和暗部">
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
              <ProductSilhouette />
              <circle cx="47" cy="47" r="1.5" fill="var(--color-text-muted)" />
              <circle cx="63" cy="61" r="1.2" fill="var(--color-text-muted)" />
              <circle cx="52" cy="70" r="1.4" fill="var(--color-text-muted)" />
              <path
                d="M32 82h48"
                fill="none"
                stroke="var(--color-text-muted)"
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity=".55"
              />
            </svg>
          </div>
          <figcaption>原图</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="精修后示意：灰尘去掉，暗部提亮">
              <rect
                x="10"
                y="12"
                width="92"
                height="88"
                rx="8"
                fill="var(--color-accent-soft)"
                stroke="var(--color-accent-text)"
                strokeWidth="1.4"
                strokeDasharray="4 4"
              />
              <ProductSilhouette
                fill="var(--color-surface)"
                stroke="var(--color-accent-text)"
                strokeWidth={1.6}
              />
              <path
                d="M78 30v8M74 34h8"
                stroke="var(--color-accent-text)"
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity=".7"
              />
              <path
                d="M34 84h44"
                fill="none"
                stroke="var(--color-accent-text)"
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity=".45"
              />
            </svg>
          </div>
          <figcaption>精修后</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="文字与颜色保持不变示意">
              <rect
                x="10"
                y="12"
                width="92"
                height="88"
                rx="8"
                fill="var(--color-surface)"
                stroke="var(--color-border)"
                strokeWidth="1.4"
              />
              <ProductSilhouette />
              <text
                x="55"
                y="60"
                textAnchor="middle"
                fill="var(--color-text)"
                fontSize="7"
                fontWeight="600"
                letterSpacing=".4"
              >
                LOGO
              </text>
              <circle
                cx="80"
                cy="74"
                r="9"
                fill="var(--color-accent-soft)"
                stroke="var(--color-accent-text)"
                strokeWidth="1.4"
              />
              <path
                d="m76.5 74 2.4 2.6 4.8-5.2"
                fill="none"
                stroke="var(--color-accent-text)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <figcaption>文字与颜色不变</figcaption>
        </figure>
      </div>
      <p className="concept-example-note">只处理灰尘、暗部和已有边缘；文字、Logo 与商品颜色保持不变。</p>
    </details>
  )
}
