import { useTranslation } from 'react-i18next'
import { ProductSilhouette } from './exampleArt'

/** 未上传时的光线教学示意：正面、左光与逆光各一张，统一用实线/徽标/虚线三种语法。 */
export default function RelightExample() {
  const { t } = useTranslation('workstation')
  return (
    <details className="tool-example concept-example" open>
      <summary>{t('examples.summary')}</summary>
      <div className="tool-example-row">
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label={t('examples.relight.frontAria')}>
              <ProductSilhouette />
              <line x1="56" y1="40" x2="56" y2="28" stroke="var(--color-text-secondary-strong)" strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" />
              <ellipse cx="56" cy="25" rx="10" ry="3" fill="var(--color-text-muted)" opacity=".45" />
              <rect x="47" y="91" width="18" height="12" rx="2" fill="none" stroke="var(--color-accent-text)" strokeWidth="1.6" />
              <circle cx="56" cy="97" r="3" fill="none" stroke="var(--color-accent-text)" strokeWidth="1.6" />
              <path d="M50 91l1.5-2h9L62 91" fill="none" stroke="var(--color-accent-text)" strokeWidth="1.6" />
            </svg>
          </div>
          <figcaption>{t('examples.relight.frontCaption')}</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label={t('examples.relight.leftAria')}>
              <ProductSilhouette />
              <line x1="8" y1="52" x2="32" y2="52" stroke="var(--color-accent-text)" strokeWidth="2" strokeLinecap="round" />
              <path d="M34 52l-7-3.5v7z" fill="var(--color-accent-text)" />
              <line x1="77" y1="76" x2="99" y2="89" stroke="var(--color-text-secondary-strong)" strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" />
              <ellipse cx="100" cy="90" rx="6.5" ry="2.8" fill="var(--color-text-muted)" opacity=".5" transform="rotate(24 100 90)" />
            </svg>
          </div>
          <figcaption>{t('examples.relight.leftCaption')}</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label={t('examples.relight.backAria')}>
              <circle cx="56" cy="18" r="5" fill="var(--color-accent-text)" opacity=".9" />
              <path d="M56 7v3M56 26v3M45 18h3M64 18h3M48.2 10.2l2.1 2.1M61.7 23.7l2.1 2.1M63.8 10.2l-2.1 2.1M50.3 23.7l-2.1 2.1" stroke="var(--color-accent-text)" strokeWidth="1.4" strokeLinecap="round" />
              <ProductSilhouette />
              <path d="M42 42c3-6 25-6 28 0" fill="none" stroke="var(--color-accent-text)" strokeLinecap="round" strokeWidth="2.5" opacity=".85" />
              <line x1="56" y1="79" x2="56" y2="91" stroke="var(--color-text-secondary-strong)" strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" />
              <ellipse cx="56" cy="94" rx="14" ry="4" fill="var(--color-text-muted)" opacity=".45" />
            </svg>
          </div>
          <figcaption>{t('examples.relight.backCaption')}</figcaption>
        </figure>
      </div>
      <p className="concept-example-note">{t('examples.relight.note')}</p>
    </details>
  )
}
