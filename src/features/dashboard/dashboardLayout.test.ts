import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/features/dashboard/dashboard.css'), 'utf8')

describe('最近作品布局', () => {
  it('1280 及以上按容器等分 8 列，窄屏保留固定卡片和深色滚动条', () => {
    const wide = css.slice(css.indexOf('@media (min-width: 1280px)'), css.indexOf('@media (max-width: 719px)'))
    expect(wide).toMatch(/grid-template-columns:\s*repeat\(8,\s*minmax\(0,\s*1fr\)\)/)
    expect(wide).toMatch(/overflow-x:\s*hidden/)
    expect(wide).toMatch(/min-width:\s*0/)
    expect(css).toMatch(/aspect-ratio:\s*158\s*\/\s*126/)
    expect(css).toMatch(/scrollbar-color:\s*var\(--color-border-strong\)\s*transparent/)
    expect(css).toMatch(/color-scheme:\s*dark/)
    const mobile = css.slice(css.indexOf('@media (max-width: 719px)'))
    expect(mobile).toMatch(/flex:\s*0 0 138px/)
    expect(mobile).toMatch(/height:\s*110px/)
    expect(css).toMatch(/\.dashboard-works-scroller\.has-right-fade::after/)
    expect(css).toMatch(/\.dashboard-works-scroller\.has-left-fade::before/)
  })
})
