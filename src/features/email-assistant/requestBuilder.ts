import { i18n } from '@/i18n'
import { Capability, type EmailAssistTaskParams } from '@/types'
import type { CreateTaskPayload } from '@/services/api/task'

export function buildEmailAssistRequest(
  values: EmailAssistTaskParams,
  requestId: string = crypto.randomUUID(),
): CreateTaskPayload<EmailAssistTaskParams> {
  const sourceText = values.sourceText.trim()
  if (!sourceText) throw new Error(i18n.t('email:validation.sourceRequired'))
  const instruction = values.instruction?.trim()
  const polishStyles = values.operation === 'polish' ? values.polishStyles : undefined

  return {
    capability: Capability.EmailAssist,
    requestId,
    params: {
      sourceText,
      operation: values.operation,
      language: values.language,
      ...(instruction ? { instruction } : {}),
      ...(polishStyles?.length ? { polishStyles } : {}),
    },
  }
}
