import { useId, useState } from 'react'
import { Button, Checkbox, Input, InputNumber, Segmented, Select, Space } from 'antd'
import { DownOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
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
import { MAX_SCALE, type OutpaintOutputMode } from '@shared/outpaint'
import type { CountTool } from '@shared/preferences'
import CountMemoryHint from '@/features/preferences/CountMemoryHint'
import { canStepOutpaintTargetSize, clampOutpaintTargetSize, stepOutpaintTargetSize } from '../utils/outpaintGeometry'
import { outpaintTargetMode, type OutpaintTargetMode } from '../utils/outpaintTarget'

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
  outpaintOutputMode?: OutpaintOutputMode
  /** 扩图「输出目标」三选一；同时更新 outpaintMode 与 outpaintOutputMode。 */
  onOutpaintTargetModeChange: (mode: OutpaintTargetMode) => void
  outpaintTargetSize?: { width: number; height: number }
  /** 自由拖拽：把精确宽高回填到画布。 */
  onOutpaintTargetSizeChange?: (size: { width: number; height: number }) => void
  presetPlatform: string
  onPresetPlatformChange: (platform: string) => void
  retouchDirections?: RetouchDirection[]
  onRetouchDirectionsChange?: (directions: RetouchDirection[]) => void
  relight?: RelightOptions
  onRelightChange?: (relight: RelightOptions) => void
  promptMinHeight?: number
  /** 涂抹类工具：当前是否已有涂抹蒙版，用于面板状态与提示。 */
  hasMaskPaint?: boolean
  /** 涂抹类工具：已格式化的积分文案，报价未就绪时不传。 */
  inpaintCreditLabel?: string
  /** 裂变：本次会话里上次使用的补充要求，用于一键恢复。 */
  variationLastPrompt?: string
  onRestoreVariationPrompt?: (prompt: string) => void
}

/** InputNumber 在输入过程中可能回传字符串；统一成数字或 null，避免静默回落到旧值。 */
function numberOrNull(value: number | string | null) {
  if (value === null || value === '') return null
  const next = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(next) ? next : null
}

const labelStyle = { display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--color-text-secondary)' }
const tallPromptSize = { minRows: 10, maxRows: 16 }
const repaintPromptSize = { minRows: 4, maxRows: 8 }
/** 消除与重绘都由服务端固定使用 wanx2.1-imageedit；这里只展示用户可读名称。 */
const INPAINT_MODEL_LABEL = '通义万相 2.1 图像编辑'

/** 智能编辑的起步模板，避免用户面对空框自己发明 prompt。 */
const SMART_EDIT_PROMPT_TEMPLATES = [
  { label: '纯白背景', prompt: '换成纯白电商背景，保留商品细节和阴影' },
  { label: '户外场景', prompt: '换成户外自然场景，保持商品颜色和材质' },
  { label: '只调光线', prompt: '只调整光线和氛围，不改变商品结构和颜色' },
  { label: '清理杂物', prompt: '去除背景杂物，保持商品主体完整' },
] as const

/** 裂变的快速方向只围绕「换场景 / 换构图」，与页面承诺保持一致。 */
const VARIATION_PROMPT_TEMPLATES = [
  { label: '户外场景', prompt: '换成户外自然场景，保留商品主体和细节' },
  { label: '室内场景', prompt: '换成明亮室内场景，保留商品主体和细节' },
  { label: '俯拍构图', prompt: '改为俯拍构图，商品居中并留出空间' },
  { label: '极简留白', prompt: '改为极简留白构图，突出商品主体' },
] as const

/** 裂变的核心承诺：保留什么、改变什么、一次出几张。 */
function VariationContract({ count }: { count: number }) {
  return (
    <dl className="workstation-variation-contract">
      <div>
        <dt>保留</dt>
        <dd>商品主体与可识别性</dd>
      </div>
      <div>
        <dt>改变</dt>
        <dd>场景或构图</dd>
      </div>
      <div>
        <dt>输出</dt>
        <dd>一次生成 {count} 张变体</dd>
      </div>
    </dl>
  )
}

/** 把固定提示词里的约束摊到界面上，避免用户写出与商品保真冲突的说明。 */
function FusionContract() {
  return (
    <dl className="workstation-fusion-contract">
      <div>
        <dt>保留</dt>
        <dd>商品形状、颜色、表面纹理、印刷文字和 Logo</dd>
      </div>
      <div>
        <dt>场景</dt>
        <dd>只提供背景与氛围，不会把场景物体画进商品</dd>
      </div>
      <div>
        <dt>不添加</dt>
        <dd>不改商品本身，不加文字和水印</dd>
      </div>
    </dl>
  )
}

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
  outpaintOutputMode = 'original',
  onOutpaintTargetModeChange,
  outpaintTargetSize,
  onOutpaintTargetSizeChange,
  presetPlatform,
  onPresetPlatformChange,
  retouchDirections = [],
  onRetouchDirectionsChange,
  relight = RELIGHT_DEFAULT,
  onRelightChange,
  promptMinHeight,
  hasMaskPaint = false,
  inpaintCreditLabel,
  variationLastPrompt,
  onRestoreVariationPrompt,
}: Props) {
  const repaintPromptId = useId()
  const repaintHintId = useId()
  const erasePromptId = useId()
  // null 表示跟随内容：有备注时默认展开，用户手动收起后保持收起。
  const [relightNoteOpen, setRelightNoteOpen] = useState<boolean | null>(null)
  // 裂变与融合的补充说明都是可选项，默认收起；已有内容时自动展开。
  const [variationNoteOpen, setVariationNoteOpen] = useState<boolean | null>(null)
  const [fusionNoteOpen, setFusionNoteOpen] = useState<boolean | null>(null)
  // 扩图目标尺寸：null 表示跟随画布；输入过程中只记草稿，失焦/回车才回填。
  // 输入框不设 min/max，让任何输入都能进入草稿，提交时统一收口到合法范围。
  const [outpaintDraft, setOutpaintDraft] = useState<{ width: number | null; height: number | null } | null>(null)
  const commitOutpaintSize = () => {
    if (!sourceSize || !outpaintTargetSize || !outpaintDraft) return
    const width = numberOrNull(outpaintDraft.width) ?? outpaintTargetSize.width
    const height = numberOrNull(outpaintDraft.height) ?? outpaintTargetSize.height
    const clamped = clampOutpaintTargetSize(sourceSize.width, sourceSize.height, width, height)
    // 回到跟随状态，输入框立即显示收口后的真实尺寸。
    setOutpaintDraft(null)
    onOutpaintTargetSizeChange?.(clamped.size)
  }
  // 移动端不必精确抓住控制点：用加减按钮按 10% 步进，同样走统一收口。
  const stepOutpaintSize = (direction: 1 | -1) => {
    if (!sourceSize || !outpaintTargetSize) return
    const next = stepOutpaintTargetSize(sourceSize.width, sourceSize.height, outpaintTargetSize, direction)
    setOutpaintDraft(null)
    onOutpaintTargetSizeChange?.(next.size)
  }
  const canStepOutpaintDown = Boolean(sourceSize && outpaintTargetSize
    && canStepOutpaintTargetSize(sourceSize.width, sourceSize.height, outpaintTargetSize, -1))
  const canStepOutpaintUp = Boolean(sourceSize && outpaintTargetSize
    && canStepOutpaintTargetSize(sourceSize.width, sourceSize.height, outpaintTargetSize, 1))
  // 两个持久化字段收敛成唯一的「输出目标」，界面不再暴露互相改写的两个控件。
  const outpaintTarget = outpaintTargetMode(outpaintMode, outpaintOutputMode)
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
    const promptLabel = retouch ? '补充说明（可选）' : '编辑要求'
    const promptMaxLength = fusion ? FUSION_NOTE_MAX : retouch ? RETOUCH_NOTE_MAX : variation ? VARIATION_USER_PROMPT_MAX : model?.ui.promptMaxLength ?? PROMPT_MAX_LENGTH
    const maxCount = model?.ui.maxCount ?? 4
    const resolutions = model?.ui.resolutions ?? ['2k', '4k']
    const mapped = outputPreview(model, sourceSize, resolution)
    const constraintSize = sourceSize ? mapDragonCodeSize(sourceSize.width, sourceSize.height, resolution).size : ''
    const fourKAllowed = !sourceSize || !model?.ui.resolutionRatioConstraints?.['4k']
      || model.ui.resolutionRatioConstraints['4k'].includes(constraintSize)
    // 裂变与融合的补充说明是可选项：默认收起，已有内容时自动展开，接近上限才显示字数。
    const variationNoteExpanded = variationNoteOpen ?? Boolean(smartEditPrompt)
    const variationNoteNearLimit = smartEditPrompt.length >= Math.floor(promptMaxLength * 0.85)
    const fusionNoteExpanded = fusionNoteOpen ?? Boolean(smartEditPrompt)
    const fusionNoteNearLimit = smartEditPrompt.length >= Math.floor(promptMaxLength * 0.85)

    const countBlock = (
      <div>
        {countHeading}
        <GenerationCountPicker value={count} max={maxCount} disabled={disabled} onChange={onCountChange} />
      </div>
    )
    const resolutionBlock = (
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
    )
    const variationQuickFill = variation ? (
      <div className="workstation-variation-quickfill">
        <div style={{ ...labelStyle, marginBottom: 0 }}>快速填写</div>
        <div className="workstation-prompt-templates workstation-variation-templates" role="group" aria-label="裂变方向模板">
          {VARIATION_PROMPT_TEMPLATES.map(template => (
            <Button
              key={template.label}
              size="small"
              disabled={disabled}
              onClick={() => {
                const current = smartEditPrompt.trim()
                const next = current ? `${current}；${template.prompt}` : template.prompt
                onSmartEditPromptChange(next.slice(0, promptMaxLength))
                setVariationNoteOpen(true)
              }}
            >
              {template.label}
            </Button>
          ))}
        </div>
        {variationLastPrompt && onRestoreVariationPrompt && variationLastPrompt !== smartEditPrompt ? (
          <button
            type="button"
            className="workstation-variation-restore"
            disabled={disabled}
            title={variationLastPrompt}
            onClick={() => {
              if (!variationLastPrompt) return
              onRestoreVariationPrompt(variationLastPrompt)
              setVariationNoteOpen(true)
            }}
          >
            恢复上次要求
          </button>
        ) : null}
      </div>
    ) : null
    const promptBlock = variation ? (
      <div>
        {variationQuickFill}
        <button
          type="button"
          className="workstation-note-toggle"
          aria-expanded={variationNoteExpanded}
          aria-controls="variation-note"
          disabled={disabled}
          onClick={() => setVariationNoteOpen(!variationNoteExpanded)}
        >
          <span>{variationNoteExpanded ? '补充要求（可选）' : '添加补充要求（可选）'}</span>
          <DownOutlined rotate={variationNoteExpanded ? 180 : 0} aria-hidden="true" />
        </button>
        {variationNoteExpanded ? (
          <Input.TextArea
            id="variation-note"
            value={smartEditPrompt}
            disabled={disabled}
            onChange={(event) => onSmartEditPromptChange(event.target.value)}
            placeholder="例如：户外露营场景，俯拍"
            autoSize={{ minRows: 2, maxRows: 3 }}
            maxLength={promptMaxLength}
            aria-label="补充要求"
            showCount={variationNoteNearLimit ? {
              formatter: ({ count: current, maxLength }) => `${current} / ${maxLength ?? promptMaxLength}`,
            } : false}
          />
        ) : null}
      </div>
    ) : fusion ? (
      <div>
        <button
          type="button"
          className="workstation-note-toggle"
          aria-expanded={fusionNoteExpanded}
          aria-controls="fusion-note"
          disabled={disabled}
          onClick={() => setFusionNoteOpen(!fusionNoteExpanded)}
        >
          <span>{fusionNoteExpanded ? '补充说明（可选）' : '添加补充说明（可选）'}</span>
          <DownOutlined rotate={fusionNoteExpanded ? 180 : 0} aria-hidden="true" />
        </button>
        {fusionNoteExpanded ? (
          <Input.TextArea
            id="fusion-note"
            value={smartEditPrompt}
            disabled={disabled}
            onChange={(event) => onSmartEditPromptChange(event.target.value)}
            placeholder="例如：放在木质餐桌上，午后自然光"
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={promptMaxLength}
            aria-label="补充说明"
            showCount={fusionNoteNearLimit ? {
              formatter: ({ count: current, maxLength }) => `${current} / ${maxLength ?? promptMaxLength}`,
            } : false}
          />
        ) : null}
      </div>
    ) : (
      <div>
        <div style={labelStyle} id="workstation-prompt-label">
          {promptLabel}
          {promptRequired ? <span className="param-required" aria-hidden="true">*</span> : null}
        </div>
        <Input.TextArea
          value={smartEditPrompt}
          disabled={disabled}
          onChange={(event) => onSmartEditPromptChange(event.target.value)}
          placeholder={retouch ? '例如：保留吊牌文字' : '例如：换成纯白电商背景，保留商品细节'}
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
    )
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {intro}
        {variation ? <VariationContract count={count} /> : null}
        {fusion ? <FusionContract /> : null}
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
        {variation ? countBlock : null}
        {variation ? resolutionBlock : null}
        {promptBlock}
        {!variation ? countBlock : null}
        {!variation ? resolutionBlock : null}
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
          className={`workstation-inpaint-mask-status${hasMaskPaint ? ' is-ready' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="workstation-inpaint-mask-dot" aria-hidden="true" />
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
          <p id={repaintHintId} className={`workstation-inpaint-hint${promptMissing ? ' is-warning' : ''}`}>
            {repaintHint}
          </p>
        </div>
        <div>
          <div style={labelStyle}>输出</div>
          <dl className="workstation-inpaint-contract">
            <div>
              <dt>模型</dt>
              <dd>{INPAINT_MODEL_LABEL}</dd>
            </div>
            <div>
              <dt>尺寸</dt>
              <dd>与原图同尺寸</dd>
            </div>
            <div>
              <dt>数量</dt>
              <dd>每次 1 张</dd>
            </div>
            {inpaintCreditLabel ? (
              <div>
                <dt>积分</dt>
                <dd>{inpaintCreditLabel}</dd>
              </div>
            ) : null}
          </dl>
          <p className="workstation-inpaint-contract-note">
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
        <>
          <div
            className={`workstation-inpaint-mask-status${hasMaskPaint ? ' is-ready' : ''}`}
            role="status"
            aria-live="polite"
          >
            <span className="workstation-inpaint-mask-dot" aria-hidden="true" />
            <span>{hasMaskPaint ? '蒙版已就绪，只会修改涂抹区域' : '尚未涂抹，在左侧图片上涂抹要消除的区域'}</span>
          </div>
          <div>
            <p className="toolbox-hint" style={{ margin: '0 0 8px', fontSize: 12 }}>智能选区不消耗积分；也可以直接用画笔涂抹。</p>
            <label htmlFor={erasePromptId} style={labelStyle}>背景描述（可选）</label>
            <Input.TextArea
              id={erasePromptId}
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
          <div>
            <div style={labelStyle}>输出</div>
            <dl className="workstation-inpaint-contract">
              <div>
                <dt>模型</dt>
                <dd>{INPAINT_MODEL_LABEL}</dd>
              </div>
              <div>
                <dt>尺寸</dt>
                <dd>与原图同尺寸</dd>
              </div>
              <div>
                <dt>数量</dt>
                <dd>每次 1 张</dd>
              </div>
              {inpaintCreditLabel ? (
                <div>
                  <dt>积分</dt>
                  <dd>{inpaintCreditLabel}</dd>
                </div>
              ) : null}
            </dl>
            <p className="workstation-inpaint-contract-note">
              消除使用固定模型，暂不支持切换模型、调整分辨率或张数。
            </p>
          </div>
        </>
      ) : null}
      {capability === Capability.Outpaint ? (
        <>
          <div>
            <div style={labelStyle}>输出目标</div>
            <Segmented
              block
              aria-label="输出目标"
              options={[
                { label: '自由扩展', value: 'free' },
                { label: '平台比例', value: 'platform-ratio' },
                { label: '平台尺寸', value: 'platform-size' },
              ]}
              value={outpaintTarget}
              disabled={disabled}
              onChange={(value) => onOutpaintTargetModeChange(value as OutpaintTargetMode)}
            />
            <p className="toolbox-hint" style={{ margin: '8px 0 0', fontSize: 12 }}>
              {outpaintTarget === 'free'
                ? '原图保持原尺寸，向外延伸画面。'
                : outpaintTarget === 'platform-ratio'
                  ? '沿用原图分辨率，只把画幅改成平台比例。'
                  : '按平台精确像素缩放原图并补全背景。'}
              {/* 尺寸变化用 polite 播报，键盘调整时读屏能听到新目标。 */}
              <span aria-live="polite">
                {sourceSize && outpaintTargetSize ? ` 预计输出 ${outpaintTargetSize.width} × ${outpaintTargetSize.height} 像素。` : ' 上传图片后显示预计尺寸。'}
              </span>
            </p>
          </div>
          {outpaintTarget === 'free' && sourceSize && outpaintTargetSize ? (
            <div>
              <div style={labelStyle}>目标尺寸</div>
              <div className="workstation-outpaint-size">
                <Button
                  className="workstation-outpaint-step"
                  size="small"
                  aria-label="缩小目标尺寸"
                  title="缩小目标尺寸"
                  icon={<MinusOutlined aria-hidden="true" />}
                  disabled={disabled || !canStepOutpaintDown}
                  onClick={() => stepOutpaintSize(-1)}
                />
                <InputNumber
                  aria-label="目标宽度"
                  precision={0}
                  value={outpaintDraft ? outpaintDraft.width : outpaintTargetSize.width}
                  disabled={disabled}
                  onChange={(value) => setOutpaintDraft(prev => ({
                    width: value,
                    height: prev ? prev.height : null,
                  }))}
                  onBlur={commitOutpaintSize}
                  onPressEnter={commitOutpaintSize}
                />
                <span className="workstation-outpaint-size-sep" aria-hidden="true">×</span>
                <InputNumber
                  aria-label="目标高度"
                  precision={0}
                  value={outpaintDraft ? outpaintDraft.height : outpaintTargetSize.height}
                  disabled={disabled}
                  onChange={(value) => setOutpaintDraft(prev => ({
                    width: prev ? prev.width : null,
                    height: value,
                  }))}
                  onBlur={commitOutpaintSize}
                  onPressEnter={commitOutpaintSize}
                />
                <Button
                  className="workstation-outpaint-step"
                  size="small"
                  aria-label="放大目标尺寸"
                  title="放大目标尺寸"
                  icon={<PlusOutlined aria-hidden="true" />}
                  disabled={disabled || !canStepOutpaintUp}
                  onClick={() => stepOutpaintSize(1)}
                />
              </div>
              <p className="toolbox-hint" style={{ margin: '6px 0 0', fontSize: 12 }}>
                单边最多扩到 {MAX_SCALE} 倍；超出会自动收住到合法尺寸。
              </p>
            </div>
          ) : null}
          {outpaintTarget !== 'free' ? (
            <div>
              <div style={labelStyle}>目标平台</div>
              <Select
                aria-label="目标平台"
                style={{ width: '100%' }}
                value={presetPlatform}
                disabled={disabled}
                onChange={onPresetPlatformChange}
                options={PLATFORM_SIZE_PRESETS.map((preset) => ({
                  value: preset.platform,
                  label: outpaintTarget === 'platform-size'
                    ? `${preset.label} · ${preset.width}×${preset.height}`
                    : `${preset.label} · 仅使用比例`,
                }))}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </Space>
  )
}
