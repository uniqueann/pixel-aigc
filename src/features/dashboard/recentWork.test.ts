// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { isPreferencePage } from '@shared/preferences'
import { normalizeToolHref, readRecentWork, recentWorkKey, rememberSavedProject, rememberTool, seedRecentTool } from './recentWork'
import { resumeProjects } from './projects'
import { QUICK_START_GROUPS } from './catalog'

beforeEach(() => localStorage.clear())

describe('首页最近工作摘要', () => {
  it('记录工具按账号隔离、去重保留最近三项，不记录上传或任意查询参数', () => {
    rememberTool('甲', '/image-workstation/remove?prompt=私密内容')
    rememberTool('甲', '/toolbox/watermark')
    rememberTool('甲', '/toolbox/pipeline')
    rememberTool('甲', '/email?mode=batch&operation=reply')
    rememberTool('甲', '/toolbox/pipeline')
    rememberTool('甲', '/')
    rememberTool('乙', '/email')
    expect(readRecentWork('甲').tools.map(item => item.href)).toEqual(['/toolbox/pipeline', '/email?mode=batch', '/toolbox/watermark'])
    expect(readRecentWork('乙').tools.map(item => item.href)).toEqual(['/email?mode=single'])
    expect(localStorage.getItem(recentWorkKey('甲'))).not.toContain('私密内容')
    expect(normalizeToolHref('//example.com/toolbox/pipeline')).toBeUndefined()
    expect(normalizeToolHref('/canvas/text-to-image')).toBeUndefined()
    expect(isPreferencePage('/toolbox/pipeline')).toBe(true)
  })

  it('损坏缓存自动恢复，旧偏好仅在没有最近工具时补入', () => {
    localStorage.setItem(recentWorkKey('甲'), '{损坏')
    expect(readRecentWork('甲')).toEqual({ tools: [], projects: [] })
    seedRecentTool('甲', '/image-workstation/repaint')
    seedRecentTool('甲', '/email')
    expect(readRecentWork('甲').tools.map(item => item.href)).toEqual(['/image-workstation/repaint'])
  })

  it('本机存档只保存轻量摘要，当前项目优先且未同步内容不被云端覆盖', () => {
    for (const [id, pending] of [['本机', true], ['已同步', false]] as const) rememberSavedProject('甲', {
      project: { id, name: `画布${id}`, updatedAt: '2026-10-04T01:00:00Z' }, cloud: { pending },
    })
    const merged = resumeProjects(readRecentWork('甲').projects, [
      { id: '本机', name: '云端旧版', revision: 1, updatedAt: '2026-10-05T01:00:00Z' },
      { id: '已同步', name: '云端新版', revision: 2, updatedAt: '2026-10-05T02:00:00Z' },
      { id: '远端', name: '远端', revision: 1, updatedAt: '2026-10-05T03:00:00Z' },
    ], { id: '本机', name: '正在编辑', source: 'local', updatedAt: '2026-10-04T02:00:00Z' })
    expect(merged.map(item => [item.id, item.source])).toEqual([['本机', 'local'], ['远端', 'cloud'], ['已同步', 'cloud']])
    expect(readRecentWork('乙').projects).toEqual([])
    expect(localStorage.getItem(recentWorkKey('甲'))).not.toContain('document')
  })

  it('四个场景共十九个独立入口，含完整邮件操作及流水线', () => {
    const groups = QUICK_START_GROUPS.map(group => group.entries.length)
    expect(groups).toEqual([9, 3, 2, 5])
    const hrefs = QUICK_START_GROUPS.flatMap(group => group.entries.map(entry => entry.href))
    expect(new Set(hrefs).size).toBe(19)
    expect(hrefs).toContain('/email?mode=single&operation=grammar')
    expect(hrefs).toContain('/toolbox/pipeline')
    const described = QUICK_START_GROUPS.flatMap(group => group.entries).filter(entry => entry.description)
    expect(described).toHaveLength(14)
    expect(described.find(entry => entry.href === '/image-workstation/variation')?.description).toBe('基于原图再生成一版变体。')
    expect(described.find(entry => entry.href === '/image-workstation/fusion')?.description).toBe('把多张图合成一个场景。')
    expect(described.find(entry => entry.href === '/canvas/text-to-image')?.description).toContain('图片')
  })
})
