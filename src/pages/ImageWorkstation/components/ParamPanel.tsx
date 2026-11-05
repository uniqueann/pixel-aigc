import { useId, useState } from 'react'
import { Button, Checkbox, Input, Segmented, Select, Space } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import GenerationCountPicker from '@/components/GenerationCountPicker'
import ModelChoice from '@/components/ModelChoice'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import type { PublicImageModel } from '@/services/api/imageModels'
import { Capability } from '@/types'
import { mapDragonCodeSize, matchImageModel } from '@shared/image-models'
import { MAX_ERASE_PROMPT_LENGTH } from '@shared/erase'
import { FUSION_NOTE_MAX } from '@shared/fusion'
import { PROMPT_MAX_LENGTH } from '@shared/prompt-limits'
import {
  RELIGHT_DEFAULT,
  relightNoteBudget,
  type RelightOptions,
} from '@shared/relight'
import RelightCompass from './RelightCompass'
import { outputPreview } from '../utils/outputPreview'
import { RETOUCH_DIRECTIONS, RETOUCH_NOTE_MAX, normalizeRetouchDirections, type RetouchDirection } from '@shared/retouch'
import { VARIATION_USER_PROMPT_MAX } from '@shared/variation'
import type { OutpaintOutputMode } from '@shared/outpaint'
import type { CountTool } from '@shared/preferences'
import CountMemoryHint from '@/features/preferences/CountMemoryHint'

interface Props {
  title?: string
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
  outpaintMode: 'free' | 'preset'
  onOutpaintModeChange: (mode: 'free' | 'preset') => void
  outpaintOutputMode?: OutpaintOutputMode
  onOutpaintOutputModeChange?: (mode: OutpaintOutputMode) => void
  outpaintTargetSize?: { width: number; height: number }
  presetPlatform: string
  onPresetPlatformChange: (platform: string) => void
  retouchDirections?: RetouchDirection[]
  onRetouchDirectionsChange?: (directions: RetouchDirection[]) => void
  relight?: RelightOptions
  onRelightChange?: (relight: RelightOptions) => void
  promptMinHeight?: number
  /** 重绘：当前是否已有涂抹蒙版，用于面板状态与提示。 */
  hasMaskPaint?: boolean
  /** 重绘：已格式化的积分文案，报价未就绪时不传。 */
  repaintCreditLabel?: string
}

const labelStyle = { display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--color-text-secondary)' }
const tallPromptSize = { minRows: 10, maxRows: 16 }
const repaintPromptSize = { minRows: 4, maxRows: 8 }
/** 服务端 server/bailian-repaint.ts 固定使用 wanx2.1-imageedit；这里只展示用户可读名称。 */
const REPAINT_MODEL_LABEL = '通义万相 2.1 图像编辑'

/** 智能编辑的起步模板，避免用户面对空框自己发明 prompt。 */
const SMART_EDIT_PROMPT_TEMPLATES = [
  { label: '纯白背景', prompt: '换成纯白电商背景，保留商品细节和阴影' },
  { label: '户外场景', prompt: '换成户外自然场景，保持商品颜色和材质' },
  { label: '只调光线', prompt: '只调整光线和氛围，不改变商品结构和颜色' },
  { label: '清理杂物', prompt: '去除背景杂物，保持商品主体完整' },
] as const

/** 右侧参数面板：按能力和子工具模式渲染对应表单 */
export default function ParamPanel({
  title,
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
  outpaintMode,
  onOutpaintModeChange,
  outpaintOutputMode = 'original',
  onOutpaintOutputModeChange,
  outpaintTargetSize,
  presetPlatform,
  onPresetPlatformChange,
  retouchDirections = [],
  onRetouchDirectionsChange,
  relight = RELIGHT_DEFAULT,
  onRelightChange,
  promptMinHeight,
  hasMaskPaint = false,
  repaintCreditLabel,
}: Props) {
  const repaintPromptId = useId()
  const repaintHintId = useId()
  // null 表示跟随内容：有备注时默认展开，用户手动收起后保持收起。
  const [relightNoteOpen, setRelightNoteOpen] = useState<boolean | null>(null)
  const intro = title ? (
    <header className="param-panel-intro">
      <h2>{title}</h2>
    </header>
  ) : null
  const countTool: CountTool | undefined = capability === Capability.ImageEdit ? 'smart-edit'
    : capability === Capability.Relight ? 'relight'
    : capability === Capability.Variation ? 'variation'
    : capability === Capability.Fusion ? 'fusion'
    : capability === Capability.Retouch ? 'retouch'
    : undefined
  const countHeading = (
    <div className="workstation-count-heading">
      <div style={{ ...labelStyle, marginBottom: 0 }}>生成数量</div>
      {countTool ? <CountMemoryHint tool={countTool} disabled={disabled} /> : null}
    </div>
  )
  if (capability === Capability.ImageEdit || capability === Capability.Variation || capability === Capability.Retouch || capability === Capability.Fusion) {
    const variation = capability === Capability.Variation
    const retouch = capability === Capability.Retouch
    const fusion = capability === Capability.Fusion
    const model = matchImageModel(models, modelProfileId) ?? models[0]
    const promptRequired = !variation && !retouch && !fusion
    const promptLabel = retouch || fusion ? '补充说明（可选）' : variation ? '补充要求（可选）' : '编辑要求'
    const promptMaxLength = fusion ? FUSION_NOTE_MAX : retouch ? RETOUCH_NOTE_MAX : variation ? VARIATION_USER_PROMPT_MAX : model?.ui.promptMaxLength ?? PROMPT_MAX_LENGTH
    const maxCount = model?.ui.maxCount ?? 4
    const resolutions = model?.ui.resolutions ?? ['2k', '4k']
    const mapped = outputPreview(model, sourceSize, resolution)
    const constraintSize = sourceSize ? mapDragonCodeSize(sourceSize.width, sourceSize.height, resolution).size : ''
    const fourKAllowed = !sourceSize || !model?.ui.resolutionRatioConstraints?.['4k']
      || model.ui.resolutionRatioConstraints['4k'].includes(constraintSize)
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {intro}
        {models.length > 1 ? (
          <div>
            <div style={labelStyle}>模型</div>
            <ModelChoice
              ariaLabel="模型"
              models={models}
              value={model?.id}
              disabled={disabled}
              hintScope={fusion ? 'image_input' : 'single_image'}
              onChange={onModelProfileIdChange}
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
          <div style={labelStyle} id="workstation-prompt-label">
            {promptLabel}
            {promptRequired ? <span className="param-required" aria-hidden="true">*</span> : null}
          </div>
          <Input.TextArea
            value={smartEditPrompt}
            disabled={disabled}
            onChange={(event) => onSmartEditPromptChange(event.target.value)}
            placeholder={fusion ? '例如：把商品放在桌面中央' : retouch ? '例如：保留吊牌文字' : variation ? '例如：户外露营场景，俯拍' : '例如：换成纯白电商背景，保留商品细节'}
            autoSize={retouch ? { minRows: 3, maxRows: 6 } : { minRows: 4, maxRows: 8 }}
            styles={promptMinHeight ? { textarea: { minHeight: promptMinHeight } } : undefined}
            style={promptMinHeight ? { minHeight: promptMinHeight } : undefined}
            maxLength={promptMaxLength}
            aria-labelledby="workstation-prompt-label"
            aria-required={promptRequired || undefined}
            showCount
          />
          {promptRequired ? (
            <div className="workstation-prompt-templates" role="group" aria-label="提示词模板">
              {SMART_EDIT_PROMPT_TEMPLATES.map(template => (
                <Button
                  key={template.label}
                  size="small"
                  disabled={disabled}
                  onClick={() => {
                    const current = smartEditPrompt.trim()
                    const next = current ? `${current}；${template.prompt}` : template.prompt
                    onSmartEditPromptChange(next.slice(0, promptMaxLength))
                  }}
                >
                  {template.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          {countHeading}
          <GenerationCountPicker value={count} max={maxCount} disabled={disabled} onChange={onCountChange} />
        </div>
        <div>
          <div style={labelStyle}>渲染分辨率</div>
          <Select
            aria-label="渲染分辨率"
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
              预计输出 {mapped.size} · {mapped.resolution.toUpperCase()}
              {!fourKAllowed ? '（当前比例不支持 4K，按 2K 生成）' : ''}
            </p>
          ) : null}
        </div>
      </Space>
    )
  }

  if (capability === Capability.Relight) {
    const model = matchImageModel(models, modelProfileId) ?? models[0]
    const maxCount = model?.ui.maxCount ?? 4
    const resolutions = model?.ui.resolutions ?? ['2k', '4k']
    const constraintSize = sourceSize ? mapDragonCodeSize(sourceSize.width, sourceSize.height, resolution).size : ''
    const fourKAllowed = !sourceSize || !model?.ui.resolutionRatioConstraints?.['4k']
      || model.ui.resolutionRatioConstraints['4k'].includes(constraintSize)
    const noteMax = relightNoteBudget(model?.ui.promptMaxLength ?? PROMPT_MAX_LENGTH)
    const noteExpanded = relightNoteOpen ?? Boolean(smartEditPrompt)
    const noteNearLimit = smartEditPrompt.length >= Math.floor(noteMax * 0.85)
    const update = (patch: Partial<RelightOptions>) => onRelightChange?.({ ...relight, ...patch })
    return (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {intro}
        {models.length > 1 ? (
          <div>
            <div style={labelStyle}>模型</div>
            <ModelChoice
              ariaLabel="模型"
              models={models}
              value={model?.id}
              disabled={disabled}
              hintScope="single_image"
              onChange={onModelProfileIdChange}
            />
          </div>
        ) : null}
        <RelightCompass value={relight} disabled={disabled} onChange={next => onRelightChange?.(next)} />
        <div className="relight-pair">
          <div>
            <div style={labelStyle}>光线质感</div>
            <Segmented
              block
              aria-label="光线质感"
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
              aria-label="色温"
              disabled={disabled}
              value={relight.temperature}
              onChange={(value) => update({ temperature: value as RelightOptions['temperature'] })}
              options={[
                { label: '暖色', value: 'warm' },
                { label: '中性', value: 'neutral' },
                { label: '冷色', value: 'cool' },
              ]}
            />
          </div>
        </div>
        <p className="toolbox-hint relight-quality-hint" style={{ margin: 0, fontSize: 12 }}>
          柔光过渡柔和；硬光对比更强。
        </p>
        <div>
          {countHeading}
          <GenerationCountPicker value={count} max={maxCount} disabled={disabled} onChange={onCountChange} />
        </div>
        <div>
          <div className="relight-resolution-row">
            <div style={{ ...labelStyle, marginBottom: 0 }}>渲染分辨率</div>
            <Select
              aria-label="渲染分辨率"
              style={{ width: 120 }}
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
          {!fourKAllowed ? (
            <p className="toolbox-hint" style={{ margin: '6px 0 0', fontSize: 12 }}>
              当前比例不支持 4K，按 2K 生成。
            </p>
          ) : null}
        </div>
        <div>
          <button
            type="button"
            className="relight-note-toggle"
            aria-expanded={noteExpanded}
            aria-controls="relight-note"
            disabled={disabled}
            onClick={() => setRelightNoteOpen(!noteExpanded)}
          >
            <span>{noteExpanded ? '补充说明（可选）' : '添加补充说明（可选）'}</span>
            <DownOutlined rotate={noteExpanded ? 180 : 0} aria-hidden="true" />
          </button>
          {noteExpanded ? (
            <Input.TextArea
              id="relight-note"
              value={smartEditPrompt}
              disabled={disabled}
              onChange={(event) => onSmartEditPromptChange(event.target.value)}
              placeholder="例如：让投影更柔和，保留杯身高光"
              autoSize={{ minRows: 3, maxRows: 6 }}
              styles={promptMinHeight ? { textarea: { minHeight: promptMinHeight } } : undefined}
              style={promptMinHeight ? { minHeight: promptMinHeight } : undefined}
              maxLength={noteMax}
              aria-label="补充说明"
              onFocus={(event) => {
                const target = event.currentTarget
                // 吸底操作栏会盖住输入框底部；聚焦时主动把备注滚到视口中间。
                // jsdom 等环境没有 scrollIntoView，跳过即可。
                requestAnimationFrame(() => {
                  if (typeof target.scrollIntoView === 'function') {
                    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
                  }
                })
              }}
              showCount={noteNearLimit ? {
                formatter: ({ count: current, maxLength }) => `${current} / ${maxLength ?? noteMax}`,
              } : false}
            />
          ) : null}
        </div>
        <p className="toolbox-hint" style={{ margin: 0, fontSize: 12 }}>模拟光影重绘效果，最终画面以生成效果为准。</p>
      </Space>
    )
  }

  if (mode === 'repaint') {
    const promptMissing = hasMaskPaint && !repaintPrompt.trim()
    // 未涂抹的引导由上方状态块和步骤条负责，这里只解释描述的作用，避免同一句话出现四次。
    const repaintHint = promptMissing
      ? '请填写重绘描述后再生成。'
      : '描述会应用到涂抹区域，未涂抹的部分保持不变。'
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {intro}
        <div
          className={`workstation-repaint-mask-status${hasMaskPaint ? ' is-ready' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="workstation-repaint-mask-dot" aria-hidden="true" />
          <span>{hasMaskPaint ? '蒙版已就绪，只会重绘涂抹区域' : '尚未涂抹，在左侧图片上涂抹要重绘的区域'}</span>
        </div>
        <div>
          <label htmlFor={repaintPromptId} style={labelStyle}>
            重绘描述<span className="param-required" aria-hidden="true">*</span>
          </label>
          <Input.TextArea
            id={repaintPromptId}
            aria-required="true"
            aria-describedby={repaintHintId}
            value={repaintPrompt}
            disabled={disabled}
            onChange={(event) => onRepaintPromptChange(event.target.value)}
            placeholder="描述选区里要出现的内容，例如：桌面上的透明玻璃花瓶"
            autoSize={repaintPromptSize}
            maxLength={MAX_ERASE_PROMPT_LENGTH}
            showCount
          />
          <p id={repaintHintId} className={`workstation-repaint-hint${promptMissing ? ' is-warning' : ''}`}>
            {repaintHint}
          </p>
        </div>
        <div>
          <div style={labelStyle}>输出</div>
          <dl className="workstation-repaint-contract">
            <div>
              <dt>模型</dt>
              <dd>{REPAINT_MODEL_LABEL}</dd>
            </div>
            <div>
              <dt>尺寸</dt>
              <dd>与原图同尺寸</dd>
            </div>
            <div>
              <dt>数量</dt>
              <dd>每次 1 张</dd>
            </div>
            {repaintCreditLabel ? (
              <div>
                <dt>积分</dt>
                <dd>{repaintCreditLabel}</dd>
              </div>
            ) : null}
          </dl>
          <p className="workstation-repaint-contract-note">
            重绘使用固定模型，暂不支持切换模型、调整分辨率或张数。
          </p>
        </div>
      </Space>
    )
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {intro}
      {mode === 'remove' ? (
        <div>
          <p className="toolbox-hint" style={{ margin: '0 0 8px', fontSize: 12 }}>上传图片后，涂抹需要消除的区域（智能选区不消耗积分）。</p>
          <div style={labelStyle}>背景描述（可选）</div>
          <Input.TextArea
            value={erasePrompt}
            disabled={disabled}
            onChange={(event) => onErasePromptChange(event.target.value)}
            placeholder="消除小物体可留空；大面积消除建议描述期望补充的背景（请勿输入「删除某某」）"
            autoSize={tallPromptSize}
            styles={promptMinHeight ? { textarea: { minHeight: promptMinHeight } } : undefined}
            style={promptMinHeight ? { minHeight: promptMinHeight } : undefined}
            maxLength={MAX_ERASE_PROMPT_LENGTH}
            showCount
          />
        </div>
      ) : null}
      {capability === Capability.Outpaint ? (
        <>
          <div>
            <div style={labelStyle}>输出模式</div>
            <Select
              aria-label="扩图输出模式"
              style={{ width: '100%' }}
              value={outpaintOutputMode}
              disabled={disabled}
              onChange={onOutpaintOutputModeChange}
              options={[
                { label: '保留原图分辨率', value: 'original' },
                { label: '按平台尺寸输出', value: 'platform' },
              ]}
            />
            <p className="toolbox-hint" style={{ margin: '8px 0 0', fontSize: 12 }}>
              {outpaintOutputMode === 'original' ? '原图保持原尺寸，向外延伸画面。' : '按目标平台比例缩放原图并补全背景。'}
              {sourceSize && outpaintTargetSize ? ` 预计输出 ${outpaintTargetSize.width} × ${outpaintTargetSize.height} 像素。` : ' 上传图片后显示预计尺寸。'}
            </p>
          </div>
          <div>
            <div style={labelStyle}>扩图方式</div>
            <Segmented
              block
              options={[
                { label: '自由拖拽', value: 'free' },
                { label: '平台预设', value: 'preset' },
              ]}
              value={outpaintMode}
              disabled={disabled}
              onChange={(value) => onOutpaintModeChange(value as 'free' | 'preset')}
            />
          </div>
          {outpaintMode === 'preset' ? (
            <div>
              <div style={labelStyle}>{outpaintOutputMode === 'original' ? '参考平台比例' : '目标平台'}</div>
              <Select
                style={{ width: '100%' }}
                value={presetPlatform}
                disabled={disabled}
                onChange={onPresetPlatformChange}
                options={PLATFORM_SIZE_PRESETS.map((preset) => ({
                  value: preset.platform,
                  label: outpaintOutputMode === 'original' ? `${preset.label} · 仅使用比例` : `${preset.label} · ${preset.width}×${preset.height}`,
                }))}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </Space>
  )
}
