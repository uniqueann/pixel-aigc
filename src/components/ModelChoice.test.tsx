// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ModelChoice from './ModelChoice'

const models = [
  { id: 'dragoncode:gpt-image-2', label: 'GPT Image 2', vendor: 'openai' },
  { id: 'bailian:qwen-image-3.0', label: 'Qwen Image 3.0', vendor: 'qwen' },
  { id: 'bailian:qwen-image-3.0-pro', label: 'Qwen Image 3.0 Pro' },
  { id: 'openrouter:gemini-nano-banana-2.1', label: 'Google Nano Banana 2.1' },
  { id: 'deepseek:用户默认模型', label: '用户默认模型', vendor: 'dragoncode' },
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
