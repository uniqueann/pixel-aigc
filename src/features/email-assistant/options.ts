import type { EmailAssistLanguage, EmailAssistOperation, EmailPolishStyle } from '@/types'

export const EMAIL_OPERATIONS: { value: EmailAssistOperation; label: string }[] = [
  { value: 'summarize', label: '总结' },
  { value: 'reply', label: '回复' },
  { value: 'polish', label: '润色' },
  { value: 'grammar', label: '检查语法' },
]

export const EMAIL_POLISH_STYLES: { value: EmailPolishStyle; label: string }[] = [
  { value: 'clear', label: '提升表达清晰度' },
  { value: 'shorten', label: '缩短' },
  { value: 'lengthen', label: '增长' },
  { value: 'simplify', label: '简化' },
]

export const EMAIL_LANGUAGES: { value: EmailAssistLanguage; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
]

export const EMAIL_BATCH_HEADERS = ['原始邮件内容', '编写指导', '生成设置', '语言'] as const
export const EMAIL_BATCH_MAX_ROWS = 50
export const EMAIL_BATCH_MAX_BYTES = 5 * 1024 * 1024
