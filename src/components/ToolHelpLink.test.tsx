// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { HELP_ARTICLES } from '@/pages/Help/articles'
import ToolHelpLink from './ToolHelpLink'
afterEach(cleanup)
describe('工具标题帮助入口', () => {
  it.each([
    ['/image-workstation/repaint', '/help/workstation'], ['/image-workstation/fusion', '/help/workstation'],
    ['/toolbox/bg-remove', '/help/bg-remove'], ['/toolbox/watermark', '/help/toolbox'],
    ['/toolbox/aspect-ratio', '/help/toolbox'], ['/toolbox/pipeline', '/help/toolbox'],
    ['/email?mode=batch', '/help/email-assistant'], ['/canvas/text-to-image', '/help/canvas'], ['/canvas/text-to-video', '/help/canvas'],
  ])('%s 直达实际存在的文章', (path, href) => {
    render(<MemoryRouter initialEntries={[path]}><ToolHelpLink /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '当前工具使用帮助' }).getAttribute('href')).toBe(href)
    expect(HELP_ARTICLES.some(article => href === `/help/${article.slug}`)).toBe(true)
  })
  it('首页不显示工具问号', () => {
    render(<MemoryRouter><ToolHelpLink /></MemoryRouter>)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
