function ProductSilhouette() {
  return (
    <>
      <path
        d="M40 40h30v32a7 7 0 0 1-7 7H47a7 7 0 0 1-7-7V40Z"
        fill="var(--color-surface-2)"
        stroke="var(--color-border-strong)"
        strokeWidth="1.5"
      />
      <path
        d="M70 47h5a8 8 0 0 1 0 16h-5"
        fill="none"
        stroke="var(--color-border-strong)"
        strokeWidth="1.5"
      />
    </>
  )
}

/** 未上传时的光线教学示意：同一商品在左光与逆光下的方向关系。 */
export default function RelightExample() {
  return (
    <details className="tool-example workstation-panel" open>
      <summary>示例</summary>
      <div className="tool-example-row">
        <figure>
          <div className="relight-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="左光示意：光从左侧来，影子落向右侧">
              <ProductSilhouette />
              <line x1="8" y1="52" x2="32" y2="52" stroke="var(--color-accent-text)" strokeWidth="2" strokeLinecap="round" />
              <path d="M34 52l-7-3.5v7z" fill="var(--color-accent-text)" />
              <line x1="77" y1="76" x2="99" y2="89" stroke="var(--color-text-secondary-strong)" strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" />
              <ellipse cx="100" cy="90" rx="6.5" ry="2.8" fill="var(--color-text-muted)" opacity=".5" transform="rotate(24 100 90)" />
            </svg>
          </div>
          <figcaption>左光：左侧受光，影子向右</figcaption>
        </figure>
        <figure>
          <div className="relight-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label="逆光示意：光从商品背后而来，轮廓发光，影子朝镜头">
              <line x1="56" y1="8" x2="56" y2="29" stroke="var(--color-accent-text)" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
              <path d="M56 33l-3.5-7h7z" fill="var(--color-accent-text)" />
              <ProductSilhouette />
              <path d="M42 40h26" stroke="var(--color-accent-text)" strokeWidth="2.5" strokeLinecap="round" opacity=".85" />
              <line x1="56" y1="79" x2="56" y2="91" stroke="var(--color-text-secondary-strong)" strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" />
              <ellipse cx="56" cy="94" rx="14" ry="4" fill="var(--color-text-muted)" opacity=".45" />
            </svg>
          </div>
          <figcaption>逆光：轮廓发光，影子朝镜头</figcaption>
        </figure>
      </div>
      <p className="relight-example-note">箭头指向商品的方向就是主光来向，虚线指向投影。</p>
    </details>
  )
}
