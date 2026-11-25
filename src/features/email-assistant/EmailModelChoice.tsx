import { useTranslation } from 'react-i18next'
import ModelChoice from '@/components/ModelChoice'
import { emailModelHint } from '@shared/email-models'
import { translateApiError } from '@/i18n/apiErrors'
import { translateModelHint } from '@/i18n/modelLabels'
import type { EmailModelConfiguration } from './useEmailModelConfiguration'

export default function EmailModelChoice({ configuration, value, language, disabled, onChange }: {
  configuration: EmailModelConfiguration; value?: string; language?: string; disabled?: boolean; onChange: (id: string) => void
}) {
  const { t } = useTranslation('email')
  return <ModelChoice ariaLabel={t('modelChoice.ariaLabel')} value={value} disabled={disabled || configuration.loading || Boolean(configuration.error)}
    loading={configuration.loading} placeholder={t('modelChoice.placeholder')} onChange={onChange} selectStyle={{ width: '100%', maxWidth: 320 }}
    models={configuration.profiles.map(model => ({ id: model.id,
      label: t('modelChoice.creditsLabel', { label: model.label, credits: model.credits }), disabled: !model.available,
      hint: model.available
        ? translateModelHint(emailModelHint(model.id, language))
        : translateApiError({ message: model.unavailableReason ?? undefined, fallback: t('modelChoice.unavailable') }),
    }))} />
}
