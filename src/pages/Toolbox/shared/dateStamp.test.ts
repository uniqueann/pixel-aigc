import { describe, expect, it, vi } from 'vitest'
import { datedDownloadName, localDateStamp } from './dateStamp'

describe('本地下载日期', () => {
  it('用本地日历日，不用 UTC 的 toISOString', () => {
    const date = new Date(Date.UTC(2026, 9, 1, 22, 59))
    vi.spyOn(date, 'getFullYear').mockReturnValue(2026)
    vi.spyOn(date, 'getMonth').mockReturnValue(9)
    vi.spyOn(date, 'getDate').mockReturnValue(2)
    expect(date.toISOString().slice(0, 10)).toBe('2026-10-01')
    expect(localDateStamp(date)).toBe('2026-10-02')
    expect(datedDownloadName('cutout', date)).toBe('cutout_2026-10-02')
    expect(datedDownloadName('watermarked', date)).toBe('watermarked_2026-10-02')
    expect(datedDownloadName('aspect-ratio_amazon-main', date)).toBe('aspect-ratio_amazon-main_2026-10-02')
  })
})
