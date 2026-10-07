/** 图片供应商错误码对应的界面文案。服务端会写入同一句，这里在前端再映射一次。 */
export const PROVIDER_ERROR_COPY: Record<string, string> = {
  PROVIDER_FORBIDDEN: '图片服务暂不可用（上游权限限制）',
}

export function taskFailureText(errorCode: string | undefined, errorMessage: string | undefined, fallback: string) {
  if (errorCode && PROVIDER_ERROR_COPY[errorCode]) return PROVIDER_ERROR_COPY[errorCode]
  const message = errorMessage?.trim()
  return message || fallback
}
