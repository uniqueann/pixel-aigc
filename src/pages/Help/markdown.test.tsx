// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from '@/pages/Help/markdown'

describe('帮助文档 markdown 渲染器', () => {
  afterEach(cleanup)

  it('标题、段落、加粗、行内代码', () => {
    render(<Markdown body={'# 大标题\n\n这是**加粗**和`代码`。\n\n## 二级标题\n'} />)
    expect(screen.getByRole('heading', { name: '大标题' }).tagName).toBe('H2')
    expect(screen.getByRole('heading', { name: '二级标题' }).tagName).toBe('H4')
    expect(screen.getByText('加粗').tagName).toBe('STRONG')
    expect(screen.getByText('代码').tagName).toBe('CODE')
  })

  it('无序列表合成一个 ul', () => {
    const { container } = render(<Markdown body={'- 第一项\n- 第二项\n'} />)
    const ul = container.querySelector('.help-article ul')
    expect(ul).toBeTruthy()
    expect(ul!.querySelectorAll('li')).toHaveLength(2)
  })

  it('有序列表合成一个 ol', () => {
    const { container } = render(<Markdown body={'1. 第一步\n2. 第二步\n10. 第十步\n'} />)
    const ol = container.querySelector('.help-article ol')
    expect(ol).toBeTruthy()
    const items = ol!.querySelectorAll('li')
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toBe('第一步')
    expect(items[2].textContent).toBe('第十步')
  })

  it('有序列表被段落打断后分开渲染', () => {
    const { container } = render(<Markdown body={'1. 第一步\n\n中间一段\n\n1. 另起一步\n'} />)
    expect(container.querySelectorAll('.help-article ol')).toHaveLength(2)
  })

  it('链接：外链新窗口打开', () => {
    render(<Markdown body={'去 [DeepSeek](https://platform.deepseek.com) 看看\n'} />)
    const a = screen.getByRole('link', { name: 'DeepSeek' })
    expect(a.getAttribute('href')).toBe('https://platform.deepseek.com')
    expect(a.getAttribute('target')).toBe('_blank')
  })

  it('表格：表头与行', () => {
    const { container } = render(
      <Markdown body={'| 工具 | 用途 |\n|------|------|\n| 抠图 | 去背景 |\n'} />,
    )
    const table = container.querySelector('.help-article table')
    expect(table).toBeTruthy()
    expect(table!.querySelectorAll('thead th')).toHaveLength(2)
    expect(table!.querySelectorAll('tbody tr')).toHaveLength(1)
  })

  it('围栏代码块保留换行', () => {
    const { container } = render(<Markdown body={'```\n第一行\n第二行\n```\n'} />)
    const pre = container.querySelector('.help-article pre')
    expect(pre).toBeTruthy()
    expect(pre!.textContent).toContain('第一行\n第二行')
  })

  it('连续文本行合并为一段', () => {
    const { container } = render(<Markdown body={'第一行\n第二行\n'} />)
    const paras = container.querySelectorAll('.help-article .ant-typography')
    expect(paras).toHaveLength(1)
    expect(paras[0].textContent).toBe('第一行 第二行')
  })
})
