export type CapabilityAvailability = 'ready' | 'loading' | 'error' | 'soon'

/** 只有服务端确认关闭才展示即将上线，初次加载与请求失败单独呈现。 */
export function capabilityAvailability(ready: boolean | undefined, error?: unknown): CapabilityAvailability {
  if (ready === true) return 'ready'
  if (ready === false) return 'soon'
  return error ? 'error' : 'loading'
}

export function capabilityAvailabilityLabel(state: CapabilityAvailability): string {
  return { ready: '', loading: '加载中…', error: '加载失败', soon: '即将上线' }[state]
}
