// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CornerHintTextArea } from './CornerHintTextArea'

describe('CornerHintTextArea', () => {
  it('空值时在右下角显示提示文字', () => {
    const { container } = render(<CornerHintTextArea value="" placeholder="例如：换成纯白背景" />)
    const hint = container.querySelector('.corner-hint-textarea-hint')
    expect(hint).not.toBeNull()
    expect(hint?.textContent).toBe('例如：换成纯白背景')
  })

  it('有值时隐藏提示文字', () => {
    const { container } = render(<CornerHintTextArea value="已输入" placeholder="例如：换成纯白背景" />)
    expect(container.querySelector('.corner-hint-textarea-hint')).toBeNull()
  })

  it('无 placeholder 时不渲染提示层', () => {
    const { container } = render(<CornerHintTextArea value="" />)
    expect(container.querySelector('.corner-hint-textarea-hint')).toBeNull()
  })

  it('showCount 时加上让位 class', () => {
    const { container } = render(<CornerHintTextArea value="" showCount placeholder="提示" />)
    expect(container.querySelector('.corner-hint-textarea--with-count')).not.toBeNull()
  })

  it('原生 placeholder 属性保留（无障碍）', () => {
    const { container } = render(<CornerHintTextArea value="" placeholder="例如：换成纯白背景" />)
    const textarea = container.querySelector('textarea')
    expect(textarea?.getAttribute('placeholder')).toBe('例如：换成纯白背景')
  })
})
