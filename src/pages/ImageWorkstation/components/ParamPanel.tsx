import { Button, Checkbox, Input, Segmented, Select, Slider, Space } from 'antd'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import type { PublicImageModel } from '@/services/api/imageModels'
import { Capability } from '@/types'
import { mapDragonCodeSize } from '@shared/image-models'
import { FUSION_NOTE_MAX } from '@shared/fusion'
import {
  RELIGHT_DEFAULT,
  RELIGHT_DIRECTION_CHOICES,
  RELIGHT_NOTE_MAX,
  type RelightOptions,
} from '@shared/relight'
import { RETOUCH_DIRECTIONS, RETOUCH_NOTE_MAX, normalizeRetouchDirections, type RetouchDirection } from '@shared/retouch'
import { VARIATION_USER_PROMPT_MAX } from '@shared/variation'

interface Props {
  capability: Capability
  mode?: 'remove' | 'repaint'
  smartEditPrompt: string
  onSmartEditPromptChange: (prompt: string) => void
  count: number
  onCountChange: (count: number) => void
  resolution: '1k' | '2k' | '4k'
  onResolutionChange: (resolution: '1k' | '2k' | '4k') => void
  models?: PublicImageModel[]
  modelProfileId?: string
  onModelProfileIdChange?: (id: string) => void
  sourceSize?: { width: number; height: number }
  disabled?: boolean
  erasePrompt: string
  onErasePromptChange: (prompt: string) => void
  repaintPrompt: string
  onRepaintPromptChange: (prompt: string) => void
  repaintReady?: boolean
  outpaintMode: 'free' | 'preset'
  onOutpaintModeChange: (mode: 'free' | 'preset') => void
  presetPlatform: string
  onPresetPlatformChange: (platform: string) => void
  retouchDirections?: RetouchDirection[]
  onRetouchDirectionsChange?: (directions: RetouchDirection[]) => void
  relight?: RelightOptions
  onRelightChange?: (relight: RelightOptions) => void
}

const labelStyle = { marginBottom: 6, fontSize: 12, color: 'var(--color-text-secondary)' }

/** 右侧参数面板：按能力和子工具模式渲染对应表单 */
export default function ParamPanel({
  capability,
  mode,
  smartEditPrompt,
  onSmartEditPromptChange,
  count,
  onCountChange,
  resolution,
  onResolutionChange,
  models = [],
  modelProfileId,
  onModelProfileIdChange,
  sourceSize,
  disabled = false,
  erasePrompt,
  onErasePromptChange,
  repaintPrompt,
  onRepaintPromptChange,
  repaintReady = true,
  outpaintMode,
  onOutpaintModeChange,
  presetPlatform,
  onPresetPlatformChange,
  retouchDirections = [],
  onRetouchDirectionsChange,
  relight = RELIGHT_DEFAULT,
  onRelightChange,
}: Props) {
  if (capability === Capability.ImageEdit || capability === Capability.Variation || capability === Capability.Retouch || capability === Capability.Fusion) {
    const variation = capability === Capability.Variation
    const retouch = capability === Capability.Retouch
    const fusion = capability === Capability.Fusion
    const model = models.find(item => item.id === modelProfileId) ?? models[0]
    const maxCount = model?.ui.maxCount ?? 4
    const resolutions = model?.ui.resolutions ?? ['2k', '4k']
    const mapped = sourceSize
      ? mapDragonCodeSize(sourceSize.width, sourceSize.height, resolution)
      : undefined
    const fourKAllowed = !sourceSize || !model?.ui.resolutionRatioConstraints?.['4k']
      || model.ui.resolutionRatioConstraints['4k'].includes(mapped?.size ?? '')
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {models.length > 1 ? (
          <div>
            <div style={labelStyle}>模型</div>
            <Select
              style={{ width: '100%' }}
              value={model?.id}
              disabled={disabled}
              onChange={onModelProfileIdChange}
              options={models.map(item => ({ value: item.id, label: item.label }))}
            />
          </div>
        ) : null}
        {retouch ? (
          <div>
            <div style={labelStyle}>精修方向</div>
            <Checkbox.Group
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              disabled={disabled}
              value={retouchDirections}
              onChange={(values) => onRetouchDirectionsChange?.(normalizeRetouchDirections(values.map(String)))}
              options={RETOUCH_DIRECTIONS.map(item => ({ label: item.label, value: item.id }))}
            />
          </div>
        ) : null}
        <div>
          <div style={labelStyle}>{retouch || fusion ? '补充说明（可选）' : variation ? '补充要求（可选）' : '编辑要求'}</div>
          <Input.TextArea
            value={smartEditPrompt}
            disabled={disabled}
            onChange={(event) => onSmartEditPromptChange(event.target.value)}
            placeholder={fusion ? '例如：把商品放在桌面中央' : retouch ? '例如：保留吊牌文字' : variation ? '例如：户外露营场景，俯拍' : '例如：换成纯白电商背景，保留商品细节'}
            autoSize={{ minRows: retouch || fusion ? 3 : 5, maxRows: 10 }}
            maxLength={fusion ? FUSION_NOTE_MAX : retouch ? RETOUCH_NOTE_MAX : variation ? VARIATION_USER_PROMPT_MAX : model?.ui.promptMaxLength}
            showCount={retouch || variation || fusion}
          />
        </div>
        <div>
          <div style={labelStyle}>生成数量</div>
          <Slider
            min={1}
            max={maxCount}
            step={1}
            marks={Object.fromEntries(Array.from({ length: maxCount }, (_, index) => [index + 1, String(index + 1)]))}
            value={Math.min(count, maxCount)}
            disabled={disabled}
            onChange={onCountChange}
          />
        </div>
        <div>
          <div style={labelStyle}>渲染分辨率</div>
          <Select
            style={{ width: '100%' }}
            value={resolution}
            disabled={disabled}
            onChange={onResolutionChange}
            options={resolutions.map(value => ({
              value,
              label: value.toUpperCase(),
              disabled: value === '4k' && !fourKAllowed,
            }))}
          />
          {mapped ? (
            <p className="toolbox-hint" style={{ margin: '8px 0 0', fontSize: 12 }}>
              预计输出比例 {mapped.size} · {mapped.resolution.toUpperCase()}
              {!fourKAllowed ? '。当前比例不支持 4K，将以 2K 生成' : ''}
            </p>
          ) : null}
        </div>
      </Space>
    )
  }

  if (capability === Capability.Relight) {
    const model = models.find(item => item.id === modelProfileId) ?? models[0]
    const maxCount = model?.ui.maxCount ?? 4
    const resolutions = model?.ui.resolutions ?? ['2k', '4k']
    const mapped = sourceSize
      ? mapDragonCodeSize(sourceSize.width, sourceSize.height, resolution)
      : undefined
    const fourKAllowed = !sourceSize || !model?.ui.resolutionRatioConstraints?.['4k']
      || model.ui.resolutionRatioConstraints['4k'].includes(mapped?.size ?? '')
    const update = (patch: Partial<RelightOptions>) => onRelightChange?.({ ...relight, ...patch })
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <p className="toolbox-hint" style={{ margin: 0, fontSize: 12 }}>效果为 AI 重绘，光线是近似效果。</p>
        <div>
          <div style={labelStyle}>光线方向</div>
          <div className="workstation-relight-compass" role="group" aria-label="光线方向">
            {RELIGHT_DIRECTION_CHOICES.map(item => (
              <Button
                key={item.id}
                size="small"
                type={relight.direction === item.id ? 'primary' : 'default'}
                disabled={disabled}
                className={`workstation-relight-${item.id}`}
                onClick={() => update({ direction: item.id })}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <div style={labelStyle}>光质</div>
          <Segmented
            block
            disabled={disabled}
            value={relight.quality}
            onChange={(value) => update({ quality: value as RelightOptions['quality'] })}
            options={[{ label: '柔光', value: 'soft' }, { label: '硬光', value: 'hard' }]}
          />
        </div>
        <div>
          <div style={labelStyle}>色温</div>
          <Segmented
            block
            disabled={disabled}
            value={relight.temperature}
            onChange={(value) => update({ temperature: value as RelightOptions['temperature'] })}
            options={[
              { label: '暖', value: 'warm' },
              { label: '中性', value: 'neutral' },
              { label: '冷', value: 'cool' },
            ]}
          />
        </div>
        <div>
          <div style={labelStyle}>补充说明（可选）</div>
          <Input.TextArea
            value={smartEditPrompt}
            disabled={disabled}
            onChange={(event) => onSmartEditPromptChange(event.target.value)}
            placeholder="例如：略微提亮背景"
            autoSize={{ minRows: 3, maxRows: 8 }}
            maxLength={RELIGHT_NOTE_MAX}
            showCount
          />
        </div>
        <div>
          <div style={labelStyle}>生成数量</div>
          <Slider
            min={1}
            max={maxCount}
            step={1}
            marks={Object.fromEntries(Array.from({ length: maxCount }, (_, index) => [index + 1, String(index + 1)]))}
            value={Math.min(count, maxCount)}
            disabled={disabled}
            onChange={onCountChange}
          />
        </div>
        <div>
          <div style={labelStyle}>渲染分辨率</div>
          <Select
            style={{ width: '100%' }}
            value={resolution}
            disabled={disabled}
            onChange={onResolutionChange}
            options={resolutions.map(value => ({
              value,
              label: value.toUpperCase(),
              disabled: value === '4k' && !fourKAllowed,
            }))}
          />
        </div>
      </Space>
    )
  }

  if (mode === 'repaint') {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <div style={labelStyle}>重绘描述</div>
          <Input.TextArea
            value={repaintPrompt}
            disabled={disabled}
            onChange={(event) => onRepaintPromptChange(event.target.value)}
            placeholder="描述选区里要出现的内容，例如桌面上的透明玻璃花瓶"
            autoSize={{ minRows: 4, maxRows: 8 }}
          />
        </div>
        {!repaintReady && (
          <p className="toolbox-warning" style={{ margin: 0, fontSize: 12 }}>
            重绘还不能用。请确认已开通万相 wanx2.1-imageedit，并配置 DASHSCOPE_API_KEY。
          </p>
        )}
      </Space>
    )
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {mode === 'remove' ? (
        <div>
          <div style={labelStyle}>背景描述（可选）</div>
          <Input.TextArea
            value={erasePrompt}
            disabled={disabled}
            onChange={(event) => onErasePromptChange(event.target.value)}
            placeholder="小物体可留空。大面积消除时描述去掉后应留下的背景，不要写「删除xxx」"
            autoSize={{ minRows: 3, maxRows: 6 }}
            maxLength={800}
          />
        </div>
      ) : null}
      {capability === Capability.Outpaint ? (
        <>
          <div>
            <div style={labelStyle}>扩图方式</div>
            <Segmented
              block
              options={[
                { label: '自由拖拽', value: 'free' },
                { label: '平台预设', value: 'preset' },
              ]}
              value={outpaintMode}
              onChange={(value) => onOutpaintModeChange(value as 'free' | 'preset')}
            />
          </div>
          {outpaintMode === 'preset' ? (
            <div>
              <div style={labelStyle}>目标平台</div>
              <Select
                style={{ width: '100%' }}
                value={presetPlatform}
                onChange={onPresetPlatformChange}
                options={PLATFORM_SIZE_PRESETS.map((preset) => ({
                  value: preset.platform,
                  label: `${preset.label} · ${preset.width}×${preset.height}`,
                }))}
              />
            </div>
          ) : null}
        </>
      ) : mode === 'remove' ? null : (
        <div>
          <div style={labelStyle}>生成尺寸</div>
          <Select style={{ width: '100%' }} placeholder="选择平台预设" options={[]} />
        </div>
      )}

      {mode === 'remove' ? null : (
        <>
      <div>
        <div style={labelStyle}>模型</div>
        <Select style={{ width: '100%' }} defaultValue="default" options={[{ value: 'default', label: '默认模型' }]} />
      </div>
      <div>
        <div style={labelStyle}>生成数量</div>
        <Slider min={1} max={4} step={1} marks={{ 1: '1', 2: '2', 3: '3', 4: '4' }} />
      </div>
        </>
      )}
      {capability !== Capability.Outpaint && mode !== 'remove' ? (
        <div>
          <div style={labelStyle}>渲染分辨率</div>
          <Select
            style={{ width: '100%' }}
            defaultValue="2k"
            options={[
              { value: '2k', label: '2K' },
              { value: '4k', label: '4K' },
            ]}
          />
        </div>
      ) : null}
    </Space>
  )
}
