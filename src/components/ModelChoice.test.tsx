// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ModelChoice from './ModelChoice'

const models = [
  { id: 'dragoncode:gpt-image-2', label: 'GPT Image 2', vendor: 'openai' },
  { id: 'bailian:qwen-image-3.0', label: 'Qwen Image 3.0', vendor: 'qwen' },
  { id: 'bailian:qwen-image-3.0-pro', label: 'Qwen Image 3.0 Pro' },
  { id: 'openrouter:gemini-nano-banana-2.1', label: 'Google Nano Banana 2.1' },
  { id: 'unknown:用户默认模型', label: '用户默认模型', vendor: 'dragoncode' },
]

afterEach(() => cleanup())

describe('ModelChoice 厂商图标', () => {
  it('只有一个模型时，名称左侧显示厂商图标', () => {
    render(<ModelChoice ariaLabel="文生图模型" label="生成模型" models={[models[0]]} value={models[0].id} />)
    expect(screen.getByText('GPT Image 2')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: '文生图模型' })).toBeNull()
    expect(document.querySelector('.model-choice-static [data-vendor="openai"]')).toBeTruthy()
  })

  it('下拉框的已选项和展开选项都显示图标，未知厂商不显示也不报错', () => {
    render(<ModelChoice ariaLabel="文生图模型" label="生成模型" models={models} value={models[0].id} onChange={() => undefined} />)
    expect(document.querySelector('.ant-select-selection-item [data-vendor="openai"]')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '文生图模型' }))
    expect(document.querySelector('.ant-select-item-option-content [data-vendor="qwen"]')).toBeTruthy()
    expect(document.querySelectorAll('.ant-select-item-option-content [data-vendor="qwen"]')).toHaveLength(2)
    expect(document.querySelector('.ant-select-item-option-content [data-vendor="google"]')).toBeTruthy()
    const unknown = screen.getByText('用户默认模型').closest('.ant-select-item-option-content')
    expect(unknown?.querySelector('[data-vendor]')).toBeNull()
  })
})

describe('ModelChoice 短标签', () => {
  const tagged = [
    { id: 'dragoncode:gpt-image-2', label: 'GPT Image 2', vendor: 'openai', hints: { text_to_image: '支持 4K', single_image: '支持 4K' } },
    { id: 'bailian:qwen-image-3.0', label: 'Qwen Image 3.0', vendor: 'qwen', hints: { text_to_image: '最省积分', image_input: '最多 3 张参考图', single_image: '最省积分' } },
  ]

  it('只在展开的选项里显示，已选项和单模型名称不显示', () => {
    render(<ModelChoice ariaLabel="文生图模型" models={tagged} value={tagged[0].id} hintScope="text_to_image" />)
    expect(document.querySelector('.ant-select-selection-item .model-choice-hint')).toBeNull()
    expect(document.querySelector('.ant-select-selection-item')?.textContent).toBe('GPT Image 2')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '文生图模型' }))
    expect([...document.querySelectorAll('.ant-select-item-option .model-choice-hint')].map(item => item.textContent)).toEqual(['支持 4K', '最省积分'])
    expect(document.querySelector('.ant-select-selection-item .model-choice-hint')).toBeNull()
    cleanup()

    render(<ModelChoice ariaLabel="模型" models={tagged} value={tagged[1].id} hintScope="image_input" />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '模型' }))
    expect([...document.querySelectorAll('.ant-select-item-option .model-choice-hint')].map(item => item.textContent)).toEqual(['支持 4K', '最多 3 张参考图'])
    cleanup()

    render(<ModelChoice ariaLabel="文生图模型" models={[tagged[0]]} value={tagged[0].id} />)
    expect(screen.getByText('GPT Image 2')).toBeTruthy()
    expect(document.querySelector('.model-choice-hint')).toBeNull()
  })
})
