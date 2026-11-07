/** 统一的短时间格式：`10/2 18:42`。作品墙、最近作品等紧凑场景共用。 */
export function formatShortDateTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '时间未知'
}
