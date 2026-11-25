import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { useLocaleStore } from '@/i18n/store'
import { groupAssetsByDay } from './groupByDay'

const now = new Date('2026-11-07T12:00:00')

function item(id: string, createdAt: string) {
  return { id, createdAt }
}

describe('作品日期分组', () => {
  it('按本地日历日分组，今天/昨天/今年/往年标签正确', () => {
    const groups = groupAssetsByDay([
      item('a', '2026-11-07T09:00:00'),
      item('b', '2026-11-07T01:00:00'),
      item('c', '2026-11-06T23:30:00'),
      item('d', '2026-10-02T10:00:00'),
      item('e', '2025-12-31T10:00:00'),
    ], now)
    expect(groups.map(group => [group.label, group.items.map(entry => entry.id)])).toEqual([
      ['今天', ['a', 'b']],
      ['昨天', ['c']],
      ['10月2日', ['d']],
      ['2025年12月31日', ['e']],
    ])
  })

  it('保留传入顺序，组顺序跟随排序', () => {
    const groups = groupAssetsByDay([
      item('old', '2026-10-02T10:00:00'),
      item('new', '2026-11-07T09:00:00'),
    ], now)
    expect(groups.map(group => group.label)).toEqual(['10月2日', '今天'])
  })

  it('无效时间归入「时间未知」，不丢作品', () => {
    const groups = groupAssetsByDay([item('x', 'not-a-date'), item('y', '2026-11-07T09:00:00')], now)
    expect(groups.map(group => [group.label, group.items.map(entry => entry.id)])).toEqual([
      ['时间未知', ['x']],
      ['今天', ['y']],
    ])
  })
})

describe('groupAssetsByDay (en-US)', () => {
  afterEach(async () => {
    await useLocaleStore.getState().setLocale('zh-CN')
  })

  afterAll(async () => {
    await useLocaleStore.getState().setLocale('zh-CN')
  })

  it('formats Today, Yesterday, month/day, full date, and Unknown time in English', async () => {
    await useLocaleStore.getState().setLocale('en-US')
    const groups = groupAssetsByDay([
      item('a', '2026-11-07T09:00:00'),
      item('c', '2026-11-06T23:30:00'),
      item('d', '2026-10-02T10:00:00'),
      item('e', '2025-12-31T10:00:00'),
      item('x', 'not-a-date'),
    ], now)
    expect(groups.map(group => [group.label, group.items.map(entry => entry.id)])).toEqual([
      ['Today', ['a']],
      ['Yesterday', ['c']],
      ['October 2', ['d']],
      ['December 31, 2025', ['e']],
      ['Unknown time', ['x']],
    ])
  })
})
