import { Capability, type EmailAssistTaskParams } from '@/types'
import type { CreateTaskPayload } from '@/services/api/task'

export function buildEmailAssistRequest(
  values: EmailAssistTaskParams,
  requestId: string = crypto.randomUUID(),
): CreateTaskPayload<EmailAssistTaskParams> {
  const sourceText = values.sourceText.trim()
  if (!sourceText) throw new Error('请先粘贴需要处理的邮件内容')
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
