// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Capability } from '@/types'
import { publicImageModel, IMAGE_MODEL_PROFILES, NANO_BANANA_PROFILE_ID } from '@shared/image-models'
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
  onOutpaintTargetModeChange: () => undefined,
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
        onOutpaintTargetModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
      />,
    )
    expect(screen.getByText(/预计输出 1:1/)).toBeTruthy()
    expect(screen.getByText(/当前比例不支持 4K/)).toBeTruthy()
    expect(screen.getByPlaceholderText('例如：换成纯白电商背景，保留商品细节')).toHaveProperty('maxLength', PROMPT_MAX_LENGTH)
    expect(screen.getByText(`4 / ${PROMPT_MAX_LENGTH}`)).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '生成数量' })).toBeTruthy()
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('智能编辑把编辑要求标成必填，并提供可追加的起步模板', () => {
    const onChange = vi.fn()
    render(
      <ParamPanel
        capability={Capability.ImageEdit}
        smartEditPrompt=""
        onSmartEditPromptChange={onChange}
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
        onOutpaintTargetModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
      />,
    )
    const textarea = screen.getByPlaceholderText('例如：换成纯白电商背景，保留商品细节')
    expect(textarea.getAttribute('aria-required')).toBe('true')
    expect(textarea.getAttribute('aria-labelledby')).toBe('workstation-prompt-label')
    expect(screen.getByRole('group', { name: '提示词模板' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '纯白背景' }))
    expect(onChange).toHaveBeenCalledWith('换成纯白电商背景，保留商品细节和阴影')
  })

  it('裂变先说明保留/改变/输出，补充要求默认收起并按余量限制字数', () => {
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
        onOutpaintTargetModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
      />,
    )
    expect(screen.getByRole('heading', { name: '裂变' })).toBeTruthy()
    expect(screen.getByText('商品主体与可识别性')).toBeTruthy()
    expect(screen.getByText('场景或构图')).toBeTruthy()
    expect(screen.getByText('一次生成 2 张变体')).toBeTruthy()
    expect(screen.queryByText('基于原图再生成一版变体。')).toBeNull()
    const noteToggle = screen.getByRole('button', { name: /添加补充要求/ })
    expect(noteToggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByPlaceholderText('例如：户外露营场景，俯拍')).toBeNull()
    fireEvent.click(noteToggle)
    expect(noteToggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByPlaceholderText('例如：户外露营场景，俯拍')).toHaveProperty('maxLength', VARIATION_USER_PROMPT_MAX)
    expect(screen.queryByText(`0 / ${VARIATION_USER_PROMPT_MAX}`)).toBeNull()
    expect(screen.queryByText('生成尺寸')).toBeNull()
    expect(screen.getByText(/预计输出 3:2/)).toBeTruthy()
  })

  it('裂变提供四个方向模板，点击后追加并展开补充要求', () => {
    const onChange = vi.fn()
    render(
      <ParamPanel
        title="裂变"
        capability={Capability.Variation}
        smartEditPrompt=""
        onSmartEditPromptChange={onChange}
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
        onOutpaintTargetModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
      />,
    )
    expect(screen.getByText('快速填写')).toBeTruthy()
    expect(screen.getByRole('group', { name: '裂变方向模板' })).toBeTruthy()
    for (const label of ['户外场景', '室内场景', '俯拍构图', '极简留白']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: '户外场景' }))
    expect(onChange).toHaveBeenCalledWith('换成户外自然场景，保留商品主体和细节')
    expect(screen.getByRole('button', { name: /补充要求/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('裂变可恢复本次会话上次的补充要求，并展开输入框', () => {
    const onRestore = vi.fn()
    render(
      <ParamPanel
        title="裂变"
        capability={Capability.Variation}
        smartEditPrompt=""
        onSmartEditPromptChange={() => undefined}
        variationLastPrompt="上次的户外要求"
        onRestoreVariationPrompt={onRestore}
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
        onOutpaintTargetModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '恢复上次要求' }))
    expect(onRestore).toHaveBeenCalledWith('上次的户外要求')
    expect(screen.getByRole('button', { name: /补充要求/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('精修展示承诺、一键组合和四个方向说明', () => {
    const onDirections = vi.fn()
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
        onOutpaintTargetModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
        retouchDirections={['blemish']}
        onRetouchDirectionsChange={onDirections}
      />,
    )
    for (const label of ['去瑕疵', '提亮', '边缘锐化', '统一质感']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByText('商品颜色、材质与整体色相')).toBeTruthy()
    expect(screen.getByText('文字、Logo、铭牌与构图')).toBeTruthy()
    expect(screen.getByText('去掉灰尘、划痕和小脏点，不改形状')).toBeTruthy()
    expect(screen.getByText('已选：去瑕疵')).toBeTruthy()
    expect(screen.getByText('补充说明（可选）')).toBeTruthy()
    expect(screen.getByPlaceholderText('例如：保留吊牌文字')).toHaveProperty('maxLength', RETOUCH_NOTE_MAX)
    expect(screen.queryByText('生成尺寸')).toBeNull()
    expect(screen.queryByText('编辑要求')).toBeNull()
    expect(screen.getByText(/输出 \d+×\d+/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /一键精修/ }))
    expect(onDirections).toHaveBeenCalledWith(['blemish', 'brighten'])
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
        onOutpaintTargetModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
      />,
    )
    const toggle = screen.getByRole('button', { name: '添加补充说明（可选）' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByPlaceholderText('例如：放在木质餐桌上，午后自然光')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '补充说明（可选）' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByPlaceholderText('例如：放在木质餐桌上，午后自然光')).toHaveProperty('maxLength', FUSION_NOTE_MAX)
    expect(screen.getByText('商品形状、颜色、表面纹理、印刷文字和 Logo')).toBeTruthy()
    expect(screen.getByText('只提供背景与氛围，不会把场景物体画进商品')).toBeTruthy()
    expect(screen.getByText('不改商品本身，不加文字和水印')).toBeTruthy()
    expect(screen.queryByText('精修方向')).toBeNull()
    expect(screen.queryByText('生成尺寸')).toBeNull()
  })

  it('重新打光展示方向、光线质感、色温和近似效果提示', () => {
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
        onOutpaintTargetModeChange={() => undefined}
        presetPlatform="x"
        onPresetPlatformChange={() => undefined}
      />,
    )
    expect(screen.getByText('模拟光影重绘效果，最终画面以生成效果为准。')).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '光线方向' })).toBeTruthy()
    expect(screen.getByText('光线质感')).toBeTruthy()
    expect(screen.getByText('柔光过渡柔和；硬光对比更强。')).toBeTruthy()
    expect(screen.getByText('色温')).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '光线质感' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '色温' })).toBeTruthy()
    const noteMax = relightNoteBudget(model.ui.promptMaxLength ?? PROMPT_MAX_LENGTH)
    const noteToggle = screen.getByRole('button', { name: /添加补充说明/ })
    expect(noteToggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByPlaceholderText('例如：让投影更柔和，保留杯身高光')).toBeNull()
    fireEvent.click(noteToggle)
    expect(noteToggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByPlaceholderText('例如：让投影更柔和，保留杯身高光')).toHaveProperty('maxLength', noteMax)
    expect(screen.queryByText(`0 / ${noteMax}`)).toBeNull()
    expect(screen.queryByRole('combobox', { name: '模型' })).toBeNull()
    expect(screen.queryByText('后期增强')).toBeNull()
    expect(screen.queryByText('手动调整')).toBeNull()
    expect(screen.getByRole('radiogroup', { name: '生成数量' })).toBeTruthy()
  })

  it('重新打光备注接近上限时才显示字数', () => {
    const noteMax = relightNoteBudget(model.ui.promptMaxLength ?? PROMPT_MAX_LENGTH)
    const note = '字'.repeat(Math.floor(noteMax * 0.85))
    render(
      <ParamPanel
        capability={Capability.Relight}
        {...panelProps}
        smartEditPrompt={note}
        models={[model]}
        modelProfileId={model.id}
      />,
    )
    expect(screen.getByPlaceholderText('例如：让投影更柔和，保留杯身高光')).toBeTruthy()
    expect(screen.getByText(`${note.length} / ${noteMax}`)).toBeTruthy()
  })

  it('重新打光多个模型时显示下拉，并按模型限制分辨率', () => {
    const qwen = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === 'bailian:qwen-image-3.0')!)
    const nano = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === NANO_BANANA_PROFILE_ID)!)
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
    expect(optionTitles).toEqual(['GPT Image 2', 'Qwen Image 3.0', 'Nano Banana 2.1'])
    expect(document.querySelectorAll('.ant-select-item-option-content [data-vendor="qwen"]')).toHaveLength(1)
    expect(document.querySelector('.ant-select-item-option-content [data-vendor="openai"]')).toBeTruthy()
    expect(document.querySelector('.ant-select-item-option-content [data-vendor="google"]')).toBeTruthy()
    const resolution = screen.getAllByRole('combobox').find(item => item.getAttribute('aria-label') !== '模型')
    if (!resolution) throw new Error('未找到分辨率选择')
    fireEvent.mouseDown(resolution)
    expect(screen.getAllByText('1K').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2K').length).toBeGreaterThan(0)
    expect(screen.queryByText('4K')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /添加补充说明/ }))
    expect(screen.getByPlaceholderText('例如：让投影更柔和，保留杯身高光')).toHaveProperty('maxLength', relightNoteBudget(qwen.ui.promptMaxLength ?? PROMPT_MAX_LENGTH))
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
      onOutpaintTargetModeChange: () => undefined,
      presetPlatform: 'x',
      onPresetPlatformChange: () => undefined,
    }
    const { rerender } = render(<ParamPanel capability={Capability.Inpaint} mode="remove" {...shared} />)
    const erase = screen.getByPlaceholderText(/大面积消除建议描述期望补充的背景/)
    expect(erase).toHaveProperty('maxLength', MAX_ERASE_PROMPT_LENGTH)
    expect(screen.getByText(`0 / ${MAX_ERASE_PROMPT_LENGTH}`)).toBeTruthy()
    expect(screen.getByLabelText('背景描述（可选）')).toBe(erase)
    expect(screen.getByText('智能选区不消耗积分；也可以直接用画笔涂抹。')).toBeTruthy()
    expect(screen.getByText('尚未涂抹，在左侧图片上涂抹要消除的区域')).toBeTruthy()
    expect(screen.getByText('通义万相 2.1 图像编辑')).toBeTruthy()
    expect(screen.getByText('与原图同尺寸')).toBeTruthy()
    expect(screen.getByText('每次 1 张')).toBeTruthy()
    expect(screen.getByText(/消除使用固定模型/)).toBeTruthy()

    rerender(<ParamPanel capability={Capability.Inpaint} mode="remove" {...shared} hasMaskPaint />)
    expect(screen.getByText('蒙版已就绪，只会修改涂抹区域')).toBeTruthy()

    rerender(<ParamPanel capability={Capability.Inpaint} mode="repaint" {...shared} />)
    const repaint = screen.getByPlaceholderText(/透明玻璃花瓶/)
    expect(repaint).toHaveProperty('maxLength', MAX_ERASE_PROMPT_LENGTH)
    expect(screen.getByText(`0 / ${MAX_ERASE_PROMPT_LENGTH}`)).toBeTruthy()
    expect(screen.queryByText(/智能选区不消耗积分/)).toBeNull()
    expect(screen.getByText('通义万相 2.1 图像编辑')).toBeTruthy()
    expect(screen.getByText('与原图同尺寸')).toBeTruthy()
    expect(screen.getByText('每次 1 张')).toBeTruthy()
    expect(screen.getByText(/暂不支持切换模型/)).toBeTruthy()
    expect(screen.getByText('尚未涂抹，在左侧图片上涂抹要重绘的区域')).toBeTruthy()
    expect(screen.getByText('描述会应用到涂抹区域，未涂抹的部分保持不变。')).toBeTruthy()
    expect(screen.queryByText('积分')).toBeNull()

    rerender(<ParamPanel capability={Capability.Inpaint} mode="repaint" {...shared} hasMaskPaint inpaintCreditLabel="5 积分" />)
    expect(screen.getByText('蒙版已就绪，只会重绘涂抹区域')).toBeTruthy()
    expect(screen.getByText('请填写重绘描述后再生成。')).toBeTruthy()
    expect(screen.getByText('积分')).toBeTruthy()
    expect(screen.getByText('5 积分')).toBeTruthy()
  })

  it('扩图不展示无效的模型、数量和尺寸选择', () => {
    render(<ParamPanel capability={Capability.Outpaint} {...panelProps} />)
    expect(screen.queryByText('默认模型')).toBeNull()
    expect(screen.queryByText('生成数量')).toBeNull()
    expect(screen.queryByText('生成尺寸')).toBeNull()
    expect(screen.getByText('输出目标')).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '输出目标' })).toBeTruthy()
    expect(screen.getByText('自由扩展')).toBeTruthy()
    expect(screen.getByText('平台比例')).toBeTruthy()
    expect(screen.getByText('平台尺寸')).toBeTruthy()
  })

  it('扩图自由模式显示目标尺寸输入，预设模式隐藏', () => {
    const { rerender } = render(
      <ParamPanel
        capability={Capability.Outpaint}
        {...panelProps}
        sourceSize={{ width: 480, height: 320 }}
        outpaintTargetSize={{ width: 480, height: 320 }}
      />,
    )
    expect(screen.getByLabelText('目标宽度')).toBeTruthy()
    expect(screen.getByLabelText('目标高度')).toBeTruthy()
    expect(screen.getByRole('button', { name: '缩小目标尺寸' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '放大目标尺寸' })).toBeTruthy()
    expect(screen.getByText(/单边最多扩到 2 倍/)).toBeTruthy()

    rerender(
      <ParamPanel
        capability={Capability.Outpaint}
        {...panelProps}
        outpaintMode="preset"
        sourceSize={{ width: 480, height: 320 }}
        outpaintTargetSize={{ width: 480, height: 480 }}
      />,
    )
    expect(screen.queryByLabelText('目标宽度')).toBeNull()
    expect(screen.getByRole('combobox', { name: '目标平台' })).toBeTruthy()
    expect(screen.getByText(/仅使用比例/)).toBeTruthy()
  })

  it('扩图预计尺寸用 polite 播报', () => {
    render(
      <ParamPanel
        capability={Capability.Outpaint}
        {...panelProps}
        sourceSize={{ width: 480, height: 320 }}
        outpaintTargetSize={{ width: 480, height: 320 }}
      />,
    )
    const sizeText = screen.getByText(/预计输出 480 × 320 像素/)
    expect(sizeText.closest('[aria-live="polite"]')).toBeTruthy()
  })

  it('输出目标三选一同时表达扩图方式与平台输出', () => {
    const onTargetModeChange = vi.fn()
    const panel = (overrides: { outpaintMode?: 'free' | 'preset'; outpaintOutputMode?: 'original' | 'platform' }) => (
      <ParamPanel
        capability={Capability.Outpaint}
        {...panelProps}
        sourceSize={{ width: 480, height: 320 }}
        outpaintTargetSize={{ width: 480, height: 320 }}
        onOutpaintTargetModeChange={onTargetModeChange}
        {...overrides}
      />
    )
    const { rerender } = render(panel({}))
    fireEvent.click(screen.getByRole('radio', { name: '平台比例' }))
    expect(onTargetModeChange).toHaveBeenLastCalledWith('platform-ratio')

    rerender(panel({ outpaintMode: 'preset', outpaintOutputMode: 'original' }))
    fireEvent.click(screen.getByRole('radio', { name: '平台尺寸' }))
    expect(onTargetModeChange).toHaveBeenLastCalledWith('platform-size')

    rerender(panel({ outpaintMode: 'preset', outpaintOutputMode: 'platform' }))
    fireEvent.click(screen.getByRole('radio', { name: '自由扩展' }))
    expect(onTargetModeChange).toHaveBeenLastCalledWith('free')

    rerender(
      <ParamPanel
        capability={Capability.Outpaint}
        {...panelProps}
        outpaintMode="preset"
        outpaintOutputMode="platform"
        sourceSize={{ width: 480, height: 320 }}
        outpaintTargetSize={{ width: 1600, height: 1600 }}
      />,
    )
    expect(screen.getByText(/1600×1600/)).toBeTruthy()
  })

  it('扩图目标尺寸输入后回填画布', () => {
    const onOutpaintTargetSizeChange = vi.fn()
    render(
      <ParamPanel
        capability={Capability.Outpaint}
        {...panelProps}
        sourceSize={{ width: 480, height: 320 }}
        outpaintTargetSize={{ width: 480, height: 320 }}
        onOutpaintTargetSizeChange={onOutpaintTargetSizeChange}
      />,
    )
    const width = screen.getByLabelText('目标宽度')
    const height = screen.getByLabelText('目标高度')
    fireEvent.change(width, { target: { value: '700' } })
    fireEvent.change(height, { target: { value: '500' } })
    fireEvent.blur(width)
    expect(onOutpaintTargetSizeChange).toHaveBeenCalledWith({ width: 700, height: 500 })
  })

  it('扩图目标尺寸可用加减按钮步进，并在上下限禁用', () => {
    const onOutpaintTargetSizeChange = vi.fn()
    const panel = (target: { width: number; height: number }) => (
      <ParamPanel
        capability={Capability.Outpaint}
        {...panelProps}
        sourceSize={{ width: 480, height: 320 }}
        outpaintTargetSize={target}
        onOutpaintTargetSizeChange={onOutpaintTargetSizeChange}
      />
    )
    const { rerender } = render(panel({ width: 480, height: 320 }))
    // 已经等于原图，不能再缩小。
    expect(screen.getByRole('button', { name: '缩小目标尺寸' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '放大目标尺寸' }))
    expect(onOutpaintTargetSizeChange).toHaveBeenLastCalledWith({ width: 528, height: 352 })

    // 到达单边 2 倍后放大禁用，缩小仍可用。
    rerender(panel({ width: 960, height: 640 }))
    expect(screen.getByRole('button', { name: '放大目标尺寸' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '缩小目标尺寸' })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: '缩小目标尺寸' }))
    expect(onOutpaintTargetSizeChange).toHaveBeenLastCalledWith({ width: 864, height: 576 })
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
    const nano = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === NANO_BANANA_PROFILE_ID)!)
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
    expect(screen.getByText('Nano Banana 2.1')).toBeTruthy()
    expect(document.querySelector('[data-vendor="google"]')).toBeTruthy()
    expect(screen.getByText(/预计输出 1:1 · 4K/)).toBeTruthy()
    expect(screen.queryByText(/当前比例不支持 4K/)).toBeNull()
  })

  it('单图工具的选项标签不写参考图张数，融合才写', () => {
    const qwen = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === 'bailian:qwen-image-3.0')!)
    const pro = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === 'bailian:qwen-image-3.0-pro')!)
    const wide = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === 'bailian:qwen-image-2.1-pro')!)
    const nano = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === NANO_BANANA_PROFILE_ID)!)
    const models = [model, qwen, pro, wide, nano]
    const optionHints = () => [...document.querySelectorAll('.ant-select-item-option .model-choice-hint')].map(item => item.textContent)

    render(<ParamPanel capability={Capability.ImageEdit} {...panelProps} models={models} modelProfileId={model.id} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '模型' }))
    expect(optionHints()).toEqual(['支持 4K', '最省积分', '1K 划算', '2K 同价', '支持 4K'])
    expect(document.querySelector('.ant-select-selection-item .model-choice-hint')).toBeNull()
    cleanup()

    render(<ParamPanel capability={Capability.Fusion} {...panelProps} models={models} modelProfileId={wide.id} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '模型' }))
    expect(optionHints()).toEqual(['支持 4K', '最省积分', '1K 划算', '最多 10 张参考图', '支持 4K'])
    expect(document.querySelector('.ant-select-selection-item')?.textContent).toBe('Qwen Image 2.1 Pro')
    cleanup()

    render(<ParamPanel capability={Capability.Relight} {...panelProps} relight={undefined} models={models} modelProfileId={wide.id} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '模型' }))
    expect(optionHints()).toContain('2K 同价')
    expect(optionHints()).not.toContain('最多 10 张参考图')
  })
})
