function errorRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * 只取出能直接给用户看的一句。
 * 字符串原样保留；对象只读其中的 message 字符串。
 * 不把整个对象转成文本，避免出现 [object Object]，也不把其余字段带进界面。
 */
export function apiErrorText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    return text && text !== '[object Object]' ? text : undefined
  }
  const message = errorRecord(value)?.message
  if (typeof message !== 'string') return undefined
  const text = message.trim()
  return text && text !== '[object Object]' ? text : undefined
}

/** 响应体里的 error 字段。不是字符串、也没有可用 message 时返回 undefined。 */
export function responseErrorText(payload: unknown): string | undefined {
  return apiErrorText(errorRecord(payload)?.error)
}

/**
 * 业务错误码只接受字符串。顶层 code 与现有响应一致；
 * 顶层不是字符串时，才读取嵌套 error.code。
 */
export function apiErrorCode(payload: unknown): string | undefined {
  const body = errorRecord(payload)
  if (!body) return undefined
  if (typeof body.code === 'string') return body.code
  const nested = errorRecord(body.error)
  if (typeof nested?.code === 'string') return nested.code
  return undefined
}
