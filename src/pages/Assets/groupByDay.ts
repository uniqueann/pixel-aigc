import { i18n } from '@/i18n'
import { formatDayMonthLabel } from '@/i18n/format'

/** 作品墙的日期分组：按本地日历日聚合，保留传入顺序（组顺序由当前排序决定）。 */
export interface AssetDayGroup<T> {
  key: string
  label: string
  items: T[]
}

/** 本地日键：不能截 ISO 字符串，UTC 与本地时区可能差一天。 */
function localDayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function dayLabel(date: Date, now: Date, todayKey: string, yesterdayKey: string) {
  const key = localDayKey(date)
  if (key === todayKey) return i18n.t('assets:days.today')
  if (key === yesterdayKey) return i18n.t('assets:days.yesterday')
  return formatDayMonthLabel(date, date.getFullYear() === now.getFullYear())
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
      group = {
        key,
        label: valid ? dayLabel(date, now, todayKey, yesterdayKey) : i18n.t('common:time.unknown'),
        items: [],
      }
      byKey.set(key, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}
