import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')
const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/ImageWorkstation/index.tsx'), 'utf8')

function block(selector: string, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

/** 取第一段同名媒体查询，避免后面的 560px 规则把页脚覆盖盖掉。 */
function firstMedia(query: string) {
  const start = css.indexOf(query)
  const open = start < 0 ? -1 : css.indexOf('{', start)
  if (open < 0) return ''
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  return ''
}

describe('工作站页脚禁用原因', () => {
  it('禁用原因独占一行并换行，桌面和窄屏都不再省略', () => {
    const reason = block('.image-workstation-block-reason')
    expect(reason).toMatch(/flex:\s*1 0 100%/)
    expect(reason).toMatch(/max-width:\s*100%/)
    expect(reason).toMatch(/overflow:\s*visible/)
    expect(reason).toMatch(/white-space:\s*normal/)
    expect(reason).toMatch(/overflow-wrap:\s*anywhere/)
    expect(reason).not.toMatch(/ellipsis|nowrap/)
    const info = block('.image-workstation-footer-info')
    expect(info).toMatch(/flex-wrap:\s*wrap/)
    expect(info).toMatch(/overflow:\s*hidden/)
    const narrow = firstMedia('@media (max-width: 560px)')
    expect(block('.image-workstation-block-reason', narrow)).toBe('')
    expect(narrow).not.toMatch(/\.image-workstation-block-reason\s*\{[^}]*ellipsis/)
    expect(block('.image-workstation-footer-info', narrow)).toMatch(/width:\s*100%/)
    expect(narrow).toMatch(/scroll-padding-bottom:\s*calc\(168px \+ env\(safe-area-inset-bottom, 0px\)\)/)
  })

  it('完整原因仍是页脚状态文本，不改成只靠 title 或展开按钮', () => {
    expect(pageSource).toContain('id="workstation-block-reason"')
    expect(pageSource).toContain('className="image-workstation-block-reason"')
    expect(pageSource).toContain('role="status"')
    expect(pageSource).not.toMatch(/image-workstation-block-reason"[^>]*title=/)
    expect(pageSource).toContain("aria-describedby={showRetryRead ? 'workstation-retry-advice' : visibleBlockReason ? 'workstation-block-reason' : undefined}")
  })
})
