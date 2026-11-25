// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CanvasEmptyState from './CanvasEmptyState'
import { IMAGE_EXAMPLE_PROMPTS, VIDEO_EXAMPLE_PROMPTS } from './emptyStatePrompts'

const stageSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/FreeCanvasStage.tsx'), 'utf8')
const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/FreeCanvas/index.tsx'), 'utf8')

afterEach(cleanup)

describe('空白画布引导', () => {
  it('给出示例描述，点一下就把文案交给调用方', () => {
    const onUsePrompt = vi.fn()
    render(<CanvasEmptyState onUsePrompt={onUsePrompt} onFocusPrompt={vi.fn()} onPickAsset={vi.fn()} />)
    expect(screen.getByText('写一句描述，就能生成第一张图')).toBeTruthy()
    for (const prompt of IMAGE_EXAMPLE_PROMPTS) expect(screen.getByRole('button', { name: prompt })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: IMAGE_EXAMPLE_PROMPTS[0] }))
    expect(onUsePrompt).toHaveBeenCalledWith(IMAGE_EXAMPLE_PROMPTS[0])
  })

  it('切到视频模式时显示成片引导，点击示例会填入运动描述', () => {
    const onUsePrompt = vi.fn()
    const props = { onUsePrompt, onFocusPrompt: vi.fn(), onPickAsset: vi.fn() }
    const { rerender } = render(<CanvasEmptyState {...props} />)
    rerender(<CanvasEmptyState {...props} mode="video" />)
    expect(screen.getByRole('heading', { name: '写一句描述，就能生成第一条视频' })).toBeTruthy()
    expect(screen.getByText('描述主体动作或镜头运动，成片会出现在当前视野中央。')).toBeTruthy()
    for (const prompt of VIDEO_EXAMPLE_PROMPTS) expect(screen.getByRole('button', { name: prompt })).toBeTruthy()
    expect(screen.queryByRole('button', { name: IMAGE_EXAMPLE_PROMPTS[0] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: VIDEO_EXAMPLE_PROMPTS[0] }))
    expect(onUsePrompt).toHaveBeenCalledWith(VIDEO_EXAMPLE_PROMPTS[0])
  })

  it('提供填写描述与添加图片两个入口', () => {
    const onFocusPrompt = vi.fn()
    const onPickAsset = vi.fn()
    render(<CanvasEmptyState onUsePrompt={vi.fn()} onFocusPrompt={onFocusPrompt} onPickAsset={onPickAsset} />)
    fireEvent.click(screen.getByRole('button', { name: '去填写描述' }))
    fireEvent.click(screen.getByRole('button', { name: '添加图片' }))
    expect(onFocusPrompt).toHaveBeenCalledTimes(1)
    expect(onPickAsset).toHaveBeenCalledTimes(1)
  })

  it('画布为空时才渲染，节点存在时不出现', () => {
    expect(stageSource).toContain('scene.nodes.length === 0')
    expect(stageSource).toContain('emptyState')
    expect(pageSource).toContain('<CanvasEmptyState')
  })

  it('示例描述填的是当前模式的草稿，并聚焦到描述框', () => {
    expect(pageSource).toContain('const handleUseExamplePrompt')
    expect(pageSource).toContain('updateDraft({ prompt })')
    expect(pageSource).toContain("querySelector<HTMLTextAreaElement>('[data-canvas-prompt]')")
  })
})
