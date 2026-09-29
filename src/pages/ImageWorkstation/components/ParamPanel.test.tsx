// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import { publicImageModel, IMAGE_MODEL_PROFILES } from '@shared/image-models'
import { RETOUCH_NOTE_MAX } from '@shared/retouch'
import { VARIATION_USER_PROMPT_MAX } from '@shared/variation'
import ParamPanel from './ParamPanel'

const model = publicImageModel(IMAGE_MODEL_PROFILES[0])

afterEach(() => cleanup())

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
  })

  it('裂变把补充要求标成可选，并按余量限制字数', () => {
    render(
      <ParamPanel
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
})
