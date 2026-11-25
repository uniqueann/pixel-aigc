import { translateApiError } from '@/i18n/apiErrors'
import { i18n } from '@/i18n'

/** 将任务失败码和服务端错误消息映射为当前语言的界面文案。 */
export function taskFailureText(errorCode: string | undefined, errorMessage: string | undefined, fallback: string) {
  if (errorCode === 'PROVIDER_FORBIDDEN') return i18n.t('errors:codes.PROVIDER_FORBIDDEN')
  return translateApiError({ code: errorCode, message: errorMessage, fallback })
}
