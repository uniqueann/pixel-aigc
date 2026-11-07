/** 作品墙的日期分组：按本地日历日聚合，保留传入顺序（组顺序由当前排序决定）。 */
export interface AssetDayGroup<T> {
  key: string
  label: string
  items: T[]
}

const monthDay = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' })
const fullDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

/** 本地日键：不能截 ISO 字符串，UTC 与本地时区可能差一天。 */
function localDayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function dayLabel(date: Date, now: Date, todayKey: string, yesterdayKey: string) {
  const key = localDayKey(date)
  if (key === todayKey) return '今天'
  if (key === yesterdayKey) return '昨天'
  return date.getFullYear() === now.getFullYear() ? monthDay.format(date) : fullDate.format(date)
}

export function groupAssetsByDay<T extends { createdAt: string }>(
  items: T[],
  now = new Date(),
): AssetDayGroup<T>[] {
  const todayKey = localDayKey(now)
  const yesterdayKey = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const groups: AssetDayGroup<T>[] = []
  const byKey = new Map<string, AssetDayGroup<T>>()
  for (const item of items) {
    const date = new Date(item.createdAt)
    const valid = Number.isFinite(date.getTime())
    const key = valid ? localDayKey(date) : 'unknown'
    let group = byKey.get(key)
    if (!group) {
      group = { key, label: valid ? dayLabel(date, now, todayKey, yesterdayKey) : '时间未知', items: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}
