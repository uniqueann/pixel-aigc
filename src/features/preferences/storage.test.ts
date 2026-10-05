// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ASPECT_RATIO_SETTINGS } from '@/pages/Toolbox/aspect-ratio/types'
import { DEFAULT_BG_REMOVE_SETTINGS } from '@/pages/Toolbox/bg-remove/types'
import { clampSidebarWidth, clearLegacyImagePrefs, clearSidebarState, readSidebarWidth, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, writeSidebarWidth } from './storage'
import { readPrefs as readAspectPrefs, writePrefs as writeAspectPrefs } from '@/pages/Toolbox/aspect-ratio/prefs'
import { readPrefs as readBgPrefs, writePrefs as writeBgPrefs } from '@/pages/Toolbox/bg-remove/prefs'

describe('侧边栏宽度', () => {
  it('限制在图标栏和当前展开宽度之间，并按账号记住', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_MAX)
    expect(clampSidebarWidth(12.4)).toBe(SIDEBAR_WIDTH_MIN)
    expect(clampSidebarWidth(400)).toBe(SIDEBAR_WIDTH_MAX)
    expect(clampSidebarWidth(180.2)).toBe(180)
    writeSidebarWidth('甲', 180.2)
    writeSidebarWidth('乙', 90)
    expect(readSidebarWidth('甲')).toBe(180)
    expect(readSidebarWidth('乙')).toBe(90)
    localStorage.setItem(`pixel:sidebar-width:v1:${window.location.origin}:甲`, '不是数字')
    expect(readSidebarWidth('甲')).toBeUndefined()
    clearSidebarState('甲')
    expect(readSidebarWidth('甲')).toBeUndefined()
    expect(readSidebarWidth('乙')).toBe(90)
  })
})

describe('本机旧图片偏好', () => {
  afterEach(() => localStorage.clear())

  it('清除后转比例和抠图都回到默认值', async () => {
    await writeAspectPrefs('alice', { ...DEFAULT_ASPECT_RATIO_SETTINGS, selectedPresetId: 'temu-main' })
    await writeBgPrefs('alice', { background: 'transparent' })
    await clearLegacyImagePrefs('alice')
    expect(await readAspectPrefs('alice')).toEqual(DEFAULT_ASPECT_RATIO_SETTINGS)
    expect(await readBgPrefs('alice')).toEqual(DEFAULT_BG_REMOVE_SETTINGS)
  })
})
