// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { PixelIcon, PixelWordmark } from './PixelLogo'
import PostLoginLoading from './PostLoginLoading'
import { scopeSvgIds } from './scopeSvgIds'

afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

describe('品牌 SVG', () => {
  it('同一页多份字标与图标的渐变 id 不冲突，引用同步改写', () => {
    render(<><PixelWordmark /><PixelWordmark /><PixelIcon /></>)
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id).filter(id => id.includes('pa-'))
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    for (const gradient of document.querySelectorAll('linearGradient')) {
      const paint = `url(#${gradient.id})`
      expect(document.body.innerHTML).toContain(paint)
    }
  })

  it('加载动画保留减弱动效规则，且只作为登录后加载状态的标记', () => {
    render(<PostLoginLoading label="正在验证账号…" />)
    const style = document.querySelector('.post-login-loading style')?.textContent ?? ''
    expect(style).toContain('prefers-reduced-motion')
    expect(document.querySelector('.post-login-loading svg')?.getAttribute('aria-label')).toBe('Pixel AIGC 加载中')
    expect(document.body.textContent).toContain('正在验证账号…')
  })

  it('深色用浅色字标，亮色主题改成深色字标', () => {
    const css = readFileSync('src/styles/global.css', 'utf8')
    const pages = readFileSync('public/brand/pages.css', 'utf8')
    expect(css).toMatch(/--pa-logo-text:\s*#F3F4F6/)
    expect(css).toMatch(/html\[data-theme=['"]light['"]\][\s\S]*--pa-logo-text:\s*#111827/)
    expect(pages).toMatch(/--pa-logo-text:\s*#F3F4F6/)
    expect(pages).toMatch(/html\[data-theme="light"\][\s\S]*--pa-logo-text:\s*#111827/)
  })

  it('落地页和隐私页内联的横版字标与源文件一致', () => {
    const source = readFileSync('public/brand/pixel-aigc-logo-horizontal.svg', 'utf8').replace(/\s+/g, ' ').trim()
    for (const page of ['public/about.html', 'public/privacy.html']) {
      const html = readFileSync(page, 'utf8')
      const match = html.match(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 176 48"[\s\S]*?<\/svg>/)
      expect(match?.[0].replace(/\s+/g, ' ').trim()).toBe(source)
    }
  })

  it('作用域替换不会把较短 id 写进较长 id', () => {
    const svg = '<svg><linearGradient id="pa-load"/><linearGradient id="pa-load-bg"/><rect fill="url(#pa-load)"/><rect fill="url(#pa-load-bg)"/></svg>'
    const scoped = scopeSvgIds(svg, 's')
    expect(scoped).toContain('id="s-pa-load"')
    expect(scoped).toContain('id="s-pa-load-bg"')
    expect(scoped.match(/id="s-pa-load"/g)).toHaveLength(1)
    expect(scoped.match(/id="s-pa-load-bg"/g)).toHaveLength(1)
    expect(scoped.match(/url\(#s-pa-load\)/g)).toHaveLength(1)
    expect(scoped.match(/url\(#s-pa-load-bg\)/g)).toHaveLength(1)
    expect(scoped).not.toContain('s-s-')
  })
})
