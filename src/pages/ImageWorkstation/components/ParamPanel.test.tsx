// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import { publicImageModel, IMAGE_MODEL_PROFILES } from '@shared/image-models'
import ParamPanel from './ParamPanel'

const model = publicImageModel(IMAGE_MODEL_PROFILES[0])

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
})
