// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import { publicImageModel, IMAGE_MODEL_PROFILES, OPENROUTER_NANO_BANANA_PROFILE_ID } from '@shared/image-models'
import { MAX_ERASE_PROMPT_LENGTH } from '@shared/erase'
import { FUSION_NOTE_MAX } from '@shared/fusion'
import { PROMPT_MAX_LENGTH } from '@shared/prompt-limits'
import { relightNoteBudget } from '@shared/relight'
import { RETOUCH_NOTE_MAX } from '@shared/retouch'
import { VARIATION_USER_PROMPT_MAX } from '@shared/variation'
import { applyPreferencesPatch, defaultPreferences } from '@shared/preferences'
import { usePreferencesStore } from '@/features/preferences/store'
import ParamPanel from './ParamPanel'

const model = publicImageModel(IMAGE_MODEL_PROFILES[0])

const panelProps = {
  smartEditPrompt: '',
  onSmartEditPromptChange: () => undefined,
  count: 1,
  onCountChange: () => undefined,
  resolution: '2k' as const,
  onResolutionChange: () => undefined,
  erasePrompt: '',
  onErasePromptChange: () => undefined,
  repaintPrompt: '',
  onRepaintPromptChange: () => undefined,
  outpaintMode: 'free' as const,
  onOutpaintModeChange: () => undefined,
  presetPlatform: 'amazon',
  onPresetPlatformChange: () => undefined,
}

afterEach(() => {
  cleanup()
  usePreferencesStore.setState({ preferences: defaultPreferences(), status: 'local', error: null })
})

describe('智能编辑参数面板', () => {
  it('按模型能力限制数量，并在当前比例禁用 4K', () => {
    render(
      <ParamPanel
        capability={Capability.ImageEdit}
        smartEditPrompt="换成白底"
        onSmartEditPromptChange={() => undefined}
        count={2}
        onCountChange={() => undefined}
        resolution="2k"
        onResolutionChange={() => undefined}
        models={[model]}
        modelProfileId={model.id}
        sourceSize={{ width: 1000, height: 1000 }}
        erasePrompt=""
        onErasePromptChange={() => undefined}
        repaintPrompt=""
        onRepaintPromptChange={() => undefined}
        outpaintMode="free"
        onOutpaintModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
      />,
    )
    expect(screen.getByText(/预计输出比例 1:1/)).toBeTruthy()
    expect(screen.getByText(/当前比例不支持 4K/)).toBeTruthy()
    expect(screen.getByPlaceholderText('例如：换成纯白电商背景，保留商品细节')).toHaveProperty('maxLength', PROMPT_MAX_LENGTH)
    expect(screen.getByText(`4 / ${PROMPT_MAX_LENGTH}`)).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '生成数量' })).toBeTruthy()
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('裂变把补充要求标成可选，并按余量限制字数', () => {
    render(
      <ParamPanel
        title="裂变"
        capability={Capability.Variation}
        smartEditPrompt=""
        onSmartEditPromptChange={() => undefined}
        count={2}
        onCountChange={() => undefined}
        resolution="2k"
        onResolutionChange={() => undefined}
        models={[model]}
        modelProfileId={model.id}
        sourceSize={{ width: 1200, height: 800 }}
        erasePrompt=""
        onErasePromptChange={() => undefined}
        repaintPrompt=""
        onRepaintPromptChange={() => undefined}
        outpaintMode="free"
        onOutpaintModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
      />,
    )
    expect(screen.getByText('补充要求（可选）')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '裂变' })).toBeTruthy()
    expect(screen.queryByText('基于原图再生成一版变体。')).toBeNull()
    expect(screen.getByPlaceholderText('例如：户外露营场景，俯拍')).toHaveProperty('maxLength', VARIATION_USER_PROMPT_MAX)
    expect(screen.queryByText('生成尺寸')).toBeNull()
    expect(screen.getByText(/预计输出比例 3:2/)).toBeTruthy()
  })

  it('精修展示四个方向，补充说明单独计数', () => {
    render(
      <ParamPanel
        capability={Capability.Retouch}
        smartEditPrompt=""
        onSmartEditPromptChange={() => undefined}
        count={1}
        onCountChange={() => undefined}
        resolution="2k"
        onResolutionChange={() => undefined}
        models={[model]}
        modelProfileId={model.id}
        sourceSize={{ width: 1000, height: 1000 }}
        erasePrompt=""
        onErasePromptChange={() => undefined}
        repaintPrompt=""
        onRepaintPromptChange={() => undefined}
        outpaintMode="free"
        onOutpaintModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
        retouchDirections={['blemish']}
      />,
    )
    for (const label of ['去瑕疵', '提亮', '边缘锐化', '统一质感']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByText('补充说明（可选）')).toBeTruthy()
    expect(screen.getByPlaceholderText('例如：保留吊牌文字')).toHaveProperty('maxLength', RETOUCH_NOTE_MAX)
    expect(screen.queryByText('生成尺寸')).toBeNull()
    expect(screen.queryByText('编辑要求')).toBeNull()
  })

  it('融合只保留可选补充说明', () => {
    render(
      <ParamPanel
        capability={Capability.Fusion}
        smartEditPrompt=""
        onSmartEditPromptChange={() => undefined}
        count={1}
        onCountChange={() => undefined}
        resolution="2k"
        onResolutionChange={() => undefined}
        models={[model]}
        modelProfileId={model.id}
        sourceSize={{ width: 1200, height: 800 }}
        erasePrompt=""
        onErasePromptChange={() => undefined}
        repaintPrompt=""
        onRepaintPromptChange={() => undefined}
        outpaintMode="free"
        onOutpaintModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
      />,
    )
    expect(screen.getByText('补充说明（可选）')).toBeTruthy()
    expect(screen.getByPlaceholderText('例如：把商品放在桌面中央')).toHaveProperty('maxLength', FUSION_NOTE_MAX)
    expect(screen.queryByText('精修方向')).toBeNull()
    expect(screen.queryByText('生成尺寸')).toBeNull()
  })

  it('重新打光展示方向、光质、色温和近似效果提示', () => {
    render(
      <ParamPanel
        capability={Capability.Relight}
        smartEditPrompt=""
        onSmartEditPromptChange={() => undefined}
        count={2}
        onCountChange={() => undefined}
        resolution="2k"
        onResolutionChange={() => undefined}
        models={[model]}
        modelProfileId={model.id}
        sourceSize={{ width: 1000, height: 1000 }}
        erasePrompt=""
        onErasePromptChange={() => undefined}
        repaintPrompt=""
        onRepaintPromptChange={() => undefined}
        outpaintMode="free"
        onOutpaintModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
      />,
    )
    expect(screen.getByText('效果为 AI 重绘，光线是近似效果。')).toBeTruthy()
    expect(screen.getByRole('group', { name: '光线方向' })).toBeTruthy()
    expect(screen.getByText('光质')).toBeTruthy()
    expect(screen.getByText('色温')).toBeTruthy()
    const noteMax = relightNoteBudget(model.ui.promptMaxLength ?? PROMPT_MAX_LENGTH)
    expect(screen.getByPlaceholderText('例如：略微提亮背景')).toHaveProperty('maxLength', noteMax)
    expect(screen.queryByRole('combobox', { name: '模型' })).toBeNull()
    expect(screen.queryByText('后期增强')).toBeNull()
    expect(screen.queryByText('手动调整')).toBeNull()
    expect(screen.getByText(`0 / ${noteMax}`)).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '生成数量' })).toBeTruthy()
  })

  it('重新打光多个模型时显示下拉，并按模型限制分辨率', () => {
    const qwen = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === 'bailian:qwen-image-3.0')!)
    const nano = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === OPENROUTER_NANO_BANANA_PROFILE_ID)!)
    render(
      <ParamPanel
        capability={Capability.Relight}
        {...panelProps}
        resolution="2k"
        models={[model, qwen, nano]}
        modelProfileId={qwen.id}
        sourceSize={{ width: 1000, height: 1000 }}
      />,
    )
    expect(document.querySelector('.ant-select-selection-item [data-vendor="qwen"]')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '模型' }))
    const optionTitles = [...document.querySelectorAll('.ant-select-item-option')].map(item => item.getAttribute('title'))
    expect(optionTitles).toEqual(['GPT Image 2', 'Qwen Image 3.0', 'Google Nano Banana 2.1'])
    expect(document.querySelectorAll('.ant-select-item-option-content [data-vendor="qwen"]')).toHaveLength(1)
    expect(document.querySelector('.ant-select-item-option-content [data-vendor="openai"]')).toBeTruthy()
    expect(document.querySelector('.ant-select-item-option-content [data-vendor="google"]')).toBeTruthy()
    const resolution = screen.getAllByRole('combobox').find(item => item.getAttribute('aria-label') !== '模型')
    if (!resolution) throw new Error('未找到分辨率选择')
    fireEvent.mouseDown(resolution)
    expect(screen.getAllByText('1K').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2K').length).toBeGreaterThan(0)
    expect(screen.queryByText('4K')).toBeNull()
    expect(screen.getByPlaceholderText('例如：略微提亮背景')).toHaveProperty('maxLength', relightNoteBudget(qwen.ui.promptMaxLength ?? PROMPT_MAX_LENGTH))
  })

  it('消除和重绘按百炼上限显示字数，并使用加高的描述框', () => {
    const shared = {
      smartEditPrompt: '',
      onSmartEditPromptChange: () => undefined,
      count: 1,
      onCountChange: () => undefined,
      resolution: '2k' as const,
      onResolutionChange: () => undefined,
      erasePrompt: '',
      onErasePromptChange: () => undefined,
      repaintPrompt: '',
      onRepaintPromptChange: () => undefined,
      outpaintMode: 'free' as const,
      onOutpaintModeChange: () => undefined,
      presetPlatform: 'x',
      onPresetPlatformChange: () => undefined,
    }
    const { rerender } = render(<ParamPanel capability={Capability.Inpaint} mode="remove" {...shared} />)
    const erase = screen.getByPlaceholderText(/小物体可留空/)
    expect(erase).toHaveProperty('maxLength', MAX_ERASE_PROMPT_LENGTH)
    expect(screen.getByText(`0 / ${MAX_ERASE_PROMPT_LENGTH}`)).toBeTruthy()
    expect(screen.getByText('上传后用画笔或智能选区涂抹要消除的区域。智能选区免费。')).toBeTruthy()

    rerender(<ParamPanel capability={Capability.Inpaint} mode="repaint" {...shared} />)
    const repaint = screen.getByPlaceholderText(/透明玻璃花瓶/)
    expect(repaint).toHaveProperty('maxLength', MAX_ERASE_PROMPT_LENGTH)
    expect(screen.getByText(`0 / ${MAX_ERASE_PROMPT_LENGTH}`)).toBeTruthy()
    expect(screen.queryByText(/智能选区免费/)).toBeNull()
  })

  it('扩图不展示无效的模型、数量和尺寸选择', () => {
    render(<ParamPanel capability={Capability.Outpaint} {...panelProps} />)
    expect(screen.queryByText('默认模型')).toBeNull()
    expect(screen.queryByText('生成数量')).toBeNull()
    expect(screen.queryByText('生成尺寸')).toBeNull()
    expect(screen.getByText('输出模式')).toBeTruthy()
    expect(screen.getByText('扩图方式')).toBeTruthy()
  })

  it('记住的张数和默认不同时提示上次使用，恢复后清掉该张数', () => {
    usePreferencesStore.setState({
      preferences: applyPreferencesPatch(defaultPreferences(), { image: { lastUsed: { 'smart-edit': { count: 3, resolution: '4k' } } } }),
      status: 'local',
      error: null,
    })
    render(<ParamPanel capability={Capability.ImageEdit} {...panelProps} count={3} models={[model]} modelProfileId={model.id} />)
    expect(screen.getByText('上次使用')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '恢复默认生成数量' }))
    expect(screen.queryByText('上次使用')).toBeNull()
    expect(usePreferencesStore.getState().preferences.image.lastUsed['smart-edit']).toEqual({ resolution: '4k' })
    expect(usePreferencesStore.getState().preferences.image.counts['smart-edit']).toBe(1)
  })

  it('多个模型时下拉显示千问图标', () => {
    const qwen = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === 'bailian:qwen-image-3.0')!)
    const wide = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === 'bailian:qwen-image-2.1-pro')!)
    render(<ParamPanel capability={Capability.ImageEdit} {...panelProps} models={[model, qwen, wide]} modelProfileId={qwen.id} />)
    expect(document.querySelector('.ant-select-selection-item [data-vendor="qwen"]')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '模型' }))
    expect(document.querySelectorAll('.ant-select-item-option-content [data-vendor="qwen"]')).toHaveLength(2)
    expect(document.querySelector('.ant-select-item-option-content [data-vendor="openai"]')).toBeTruthy()
  })

  it('工作站可选 Nano Banana 2.1，4K 正方形仍显示 4K', () => {
    const nano = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === OPENROUTER_NANO_BANANA_PROFILE_ID)!)
    render(
      <ParamPanel
        capability={Capability.ImageEdit}
        {...panelProps}
        resolution="4k"
        models={[model, nano]}
        modelProfileId={nano.id}
        sourceSize={{ width: 1000, height: 1000 }}
      />,
    )
    expect(screen.getByText('Google Nano Banana 2.1')).toBeTruthy()
    expect(document.querySelector('[data-vendor="google"]')).toBeTruthy()
    expect(screen.getByText(/预计输出比例 1:1 · 4K/)).toBeTruthy()
    expect(screen.queryByText(/当前比例不支持 4K/)).toBeNull()
  })
})
