import ModelChoice from '@/components/ModelChoice'
import { emailModelHint } from '@shared/email-models'
import type { EmailModelConfiguration } from './useEmailModelConfiguration'

export default function EmailModelChoice({ configuration, value, language, disabled, onChange }: {
  configuration: EmailModelConfiguration; value?: string; language?: string; disabled?: boolean; onChange: (id: string) => void
}) {
  return <ModelChoice ariaLabel="本次使用的模型" value={value} disabled={disabled || configuration.loading || Boolean(configuration.error)}
    loading={configuration.loading} placeholder="选择平台模型" onChange={onChange} selectStyle={{ width: 310 }}
    models={configuration.profiles.map(model => ({ id: model.id,
      label: `${model.label} · ${model.credits} 积分`, disabled: !model.available,
      hint: model.available ? emailModelHint(model.id, language) : model.unavailableReason ?? '暂不可用',
    }))} />
}
