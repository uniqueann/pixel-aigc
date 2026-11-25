import { useTranslation } from 'react-i18next'
import { ProductSilhouette } from './exampleArt'

/**
 * 未上传时的智能编辑教学示意：用「换背景 / 换颜色 / 加元素」三张图讲清提示词能改什么。
 * 与重新打光示例共用虚线框 + 主色高亮的语法，避免用照片伪造生成结果。
 */
export default function SmartEditExample() {
  const { t } = useTranslation('workstation')
  return (
    <details className="tool-example concept-example smart-edit-example" open>
      <summary>{t('examples.summary')}</summary>
      <div className="tool-example-row">
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label={t('examples.smartEdit.bgAria')}>
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
              <circle cx="79" cy="31" r="6" fill="var(--color-accent-text)" opacity=".5" />
              <path
                d="M14 78c12-10 22-12 32-6 8 5 16 5 24 0 8-5 16-4 28 4"
                fill="none"
                stroke="var(--color-accent-text)"
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity=".4"
              />
              <ProductSilhouette />
            </svg>
          </div>
          <figcaption>{t('examples.smartEdit.bgCaption')}</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label={t('examples.smartEdit.colorAria')}>
              <ProductSilhouette
                fill="var(--color-accent-soft)"
                stroke="var(--color-accent-text)"
                strokeWidth={1.6}
              />
              <rect x="42" y="91" width="7" height="7" rx="2" fill="var(--color-text-muted)" opacity=".45" />
              <rect x="52.5" y="91" width="7" height="7" rx="2" fill="var(--color-accent-text)" />
              <rect x="63" y="91" width="7" height="7" rx="2" fill="var(--color-text-muted)" opacity=".45" />
            </svg>
          </div>
          <figcaption>{t('examples.smartEdit.colorCaption')}</figcaption>
        </figure>
        <figure>
          <div className="concept-example-art">
            <svg viewBox="0 0 112 112" role="img" aria-label={t('examples.smartEdit.propsAria')}>
              <ProductSilhouette />
              <path d="M21 84c0-8 5-13 13-13 0 8-5 13-13 13Z" fill="var(--color-accent-text)" opacity=".35" />
              <path
                d="M21 84c4-3 7-7 10-11"
                fill="none"
                stroke="var(--color-accent-text)"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <circle
                cx="82"
                cy="34"
                r="10"
                fill="var(--color-surface-2)"
                stroke="var(--color-accent-text)"
                strokeWidth="1.4"
                strokeDasharray="3 3"
              />
              <path d="M82 29v10M77 34h10" stroke="var(--color-accent-text)" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <figcaption>{t('examples.smartEdit.propsCaption')}</figcaption>
        </figure>
      </div>
      <p className="concept-example-note">{t('examples.smartEdit.note')}</p>
    </details>
  )
}
