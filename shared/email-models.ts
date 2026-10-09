import { z } from 'zod'

export const EMAIL_PRICE_VERSION = 'aigc-email-v1'
export const EMAIL_MODEL_IDS = ['deepseek:deepseek-flash', 'deepseek:deepseek-v4-pro', 'ai-gateway:gemini-3.8-flash'] as const
export const emailModelIdSchema = z.enum(EMAIL_MODEL_IDS)
export type EmailModelId = typeof EMAIL_MODEL_IDS[number]
export const EMAIL_MODELS = [
  { id: EMAIL_MODEL_IDS[0], provider: 'deepseek', model: 'deepseek-flash', label: 'DeepSeek Flash', credits: 1 },
  { id: EMAIL_MODEL_IDS[1], provider: 'deepseek', model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', credits: 3 },
  { id: EMAIL_MODEL_IDS[2], provider: 'ai-gateway', model: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', credits: 3 },
] as const
export const EMAIL_LANGUAGE_IDS = ['zh', 'en', 'en-US', 'en-GB', 'ja', 'fr', 'de', 'es', 'pt', 'it'] as const
export const emailLanguageSchema = z.enum(EMAIL_LANGUAGE_IDS)
export type EmailLanguage = typeof EMAIL_LANGUAGE_IDS[number]
export const EMAIL_LANGUAGES: { value: EmailLanguage; label: string }[] = [
  { value: 'zh', label: '中文' }, { value: 'en', label: '英语' },
  { value: 'en-US', label: '美式英语' }, { value: 'en-GB', label: '英式英语' },
  { value: 'ja', label: '日语' }, { value: 'fr', label: '法语' }, { value: 'de', label: '德语' },
  { value: 'es', label: '西班牙语' }, { value: 'pt', label: '葡萄牙语' }, { value: 'it', label: '意大利语' },
]
export function recommendedEmailModel(language: string): EmailModelId {
  return language === 'zh' || language === 'ja' ? EMAIL_MODEL_IDS[0] : EMAIL_MODEL_IDS[2]
}
export function emailModel(value: unknown) {
  const id = emailModelIdSchema.parse(value)
  return EMAIL_MODELS.find(model => model.id === id)!
}
export function emailModelHint(id: string, language?: string) {
  if (language === 'zh' && id === EMAIL_MODEL_IDS[0]) return '中文／批量推荐'
  if (language && language !== 'zh' && language !== 'ja' && id === EMAIL_MODEL_IDS[2]) return '该语种／批量推荐'
  return ''
}
