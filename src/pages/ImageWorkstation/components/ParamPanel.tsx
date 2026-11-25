import { useId, useState } from 'react'
import { Button, Checkbox, Input, InputNumber, Segmented, Select, Space } from 'antd'
import { DownOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
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
import { RETOUCH_DIRECTIONS, RETOUCH_MAX_SOURCE_PIXELS, RETOUCH_NOTE_MAX, RETOUCH_PRESETS, RETOUCH_TARGET_LONG_EDGE, normalizeRetouchDirections, retouchOutputSize, retouchResolutionForSource, type RetouchDirection } from '@shared/retouch'
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
  /**
   * 用户点选的档位。精修传入的 resolution 已是有效档，
   * 只有二者不同才能区分「选了 2K」和「4K 因比例回退到 2K」。
   */
  requestedResolution?: '1k' | '2k' | '4k'
  /** 精修：输出缩回原图像素，档位仍按原图长边推导。 */
  keepSourceSize?: boolean
  /** 精修输出尺寸：'source' 表示保持原尺寸；档位值同时关闭保持原尺寸。 */
  onRetouchOutputChange?: (value: '1k' | '2k' | '4k' | 'source') => void
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

const SMART_EDIT_TEMPLATE_KEYS = [
  { id: 'whiteBg', labelKey: 'params.smartEditTemplates.whiteBg.label', promptKey: 'params.smartEditTemplates.whiteBg.prompt' },
  { id: 'outdoor', labelKey: 'params.smartEditTemplates.outdoor.label', promptKey: 'params.smartEditTemplates.outdoor.prompt' },
  { id: 'lightingOnly', labelKey: 'params.smartEditTemplates.lightingOnly.label', promptKey: 'params.smartEditTemplates.lightingOnly.prompt' },
  { id: 'cleanClutter', labelKey: 'params.smartEditTemplates.cleanClutter.label', promptKey: 'params.smartEditTemplates.cleanClutter.prompt' },
] as const

const VARIATION_TEMPLATE_KEYS = [
  { id: 'outdoor', labelKey: 'params.variationTemplates.outdoor.label', promptKey: 'params.variationTemplates.outdoor.prompt' },
  { id: 'indoor', labelKey: 'params.variationTemplates.indoor.label', promptKey: 'params.variationTemplates.indoor.prompt' },
  { id: 'topDown', labelKey: 'params.variationTemplates.topDown.label', promptKey: 'params.variationTemplates.topDown.prompt' },
  { id: 'minimalist', labelKey: 'params.variationTemplates.minimalist.label', promptKey: 'params.variationTemplates.minimalist.prompt' },
] as const

const RETOUCH_DIRECTION_KEYS = {
  blemish: { label: 'retouch.directions.blemish.label', hint: 'retouch.directions.blemish.hint' },
  brighten: { label: 'retouch.directions.brighten.label', hint: 'retouch.directions.brighten.hint' },
  sharpen: { label: 'retouch.directions.sharpen.label', hint: 'retouch.directions.sharpen.hint' },
  texture: { label: 'retouch.directions.texture.label', hint: 'retouch.directions.texture.hint' },
} as const satisfies Record<RetouchDirection, { label: string; hint: string }>

const PLATFORM_LABEL_KEYS = {
  'amazon-main': 'platforms.amazon-main',
  'temu-main': 'platforms.temu-main',
  'shopee-main': 'platforms.shopee-main',
  'tiktok-main': 'platforms.tiktok-main',
} as const

type PlatformLabelKey = (typeof PLATFORM_LABEL_KEYS)[keyof typeof PLATFORM_LABEL_KEYS]

/** 裂变的核心承诺：保留什么、改变什么、一次出几张。 */
function VariationContract({ count }: { count: number }) {
  const { t } = useTranslation('workstation')
  return (
    <dl className="workstation-variation-contract">
      <div>
        <dt>{t('params.contracts.variation.keepLabel')}</dt>
        <dd>{t('params.contracts.variation.keepText')}</dd>
      </div>
      <div>
        <dt>{t('params.contracts.variation.changeLabel')}</dt>
        <dd>{t('params.contracts.variation.changeText')}</dd>
      </div>
      <div>
        <dt>{t('params.contracts.variation.outputLabel')}</dt>
        <dd>{t(count === 1 ? 'params.contracts.variation.outputOne' : 'params.contracts.variation.outputOther', { count })}</dd>
      </div>
    </dl>
  )
}

/** 精修的核心承诺：只做轻微修图，颜色、文字和构图都不动。 */
function RetouchContract() {
  const { t } = useTranslation('workstation')
  return (
    <dl className="workstation-retouch-contract">
      <div>
        <dt>{t('params.contracts.retouch.keepLabel')}</dt>
        <dd>{t('params.contracts.retouch.keepText')}</dd>
      </div>
      <div>
        <dt>{t('params.contracts.retouch.unchangedLabel')}</dt>
        <dd>{t('params.contracts.retouch.unchangedText')}</dd>
      </div>
      <div>
        <dt>{t('params.contracts.retouch.onlyDoLabel')}</dt>
        <dd>{t('params.contracts.retouch.onlyDoText')}</dd>
      </div>
    </dl>
  )
}

/** 把固定提示词里的约束摊到界面上，避免用户写出与商品保真冲突的说明。 */
function FusionContract() {
  const { t } = useTranslation('workstation')
  return (
    <dl className="workstation-fusion-contract">
      <div>
        <dt>{t('params.contracts.fusion.keepLabel')}</dt>
        <dd>{t('params.contracts.fusion.keepText')}</dd>
      </div>
      <div>
        <dt>{t('params.contracts.fusion.sceneLabel')}</dt>
        <dd>{t('params.contracts.fusion.sceneText')}</dd>
      </div>
      <div>
        <dt>{t('params.contracts.fusion.noAddLabel')}</dt>
        <dd>{t('params.contracts.fusion.noAddText')}</dd>
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
  requestedResolution,
  keepSourceSize = false,
  onRetouchOutputChange,
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
  const { t } = useTranslation(['workstation', 'common'])
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
      <div style={{ ...labelStyle, marginBottom: 0 }}>{t('common:controls.generationCount')}</div>
      {countTool ? <CountMemoryHint tool={countTool} disabled={disabled} /> : null}
    </div>
  )
  if (capability === Capability.ImageEdit || capability === Capability.Variation || capability === Capability.Retouch || capability === Capability.Fusion) {
    const variation = capability === Capability.Variation
    const retouch = capability === Capability.Retouch
    const fusion = capability === Capability.Fusion
    const model = matchImageModel(models, modelProfileId) ?? models[0]
    const promptRequired = !variation && !retouch && !fusion
    const promptLabel = retouch ? t('params.optionalNoteLabel') : t('params.editPromptLabel')
    const promptMaxLength = fusion ? FUSION_NOTE_MAX : retouch ? RETOUCH_NOTE_MAX : variation ? VARIATION_USER_PROMPT_MAX : model?.ui.promptMaxLength ?? PROMPT_MAX_LENGTH
    const maxCount = model?.ui.maxCount ?? 4
    const resolutions = model?.ui.resolutions ?? ['2k', '4k']
    const mapped = outputPreview(model, sourceSize, resolution)
    const constraintSize = sourceSize ? mapDragonCodeSize(sourceSize.width, sourceSize.height, resolution).size : ''
    const fourKAllowed = !sourceSize || !model?.ui.resolutionRatioConstraints?.['4k']
      || model.ui.resolutionRatioConstraints['4k'].includes(constraintSize)
    const retouchPreset = RETOUCH_PRESETS[0]
    const selectedDirections = normalizeRetouchDirections(retouchDirections)
    const presetActive = selectedDirections.length === retouchPreset.directions.length
      && retouchPreset.directions.every(direction => selectedDirections.includes(direction))
    const selectedDirectionLabel = selectedDirections
      .map(direction => t(RETOUCH_DIRECTION_KEYS[direction].label))
      .join(t('common.listSeparator'))
    const resolutionLabel = retouch ? t('params.outputSizeLabel') : t('params.renderResolutionLabel')
    const keepSource = retouch && keepSourceSize && Boolean(sourceSize)
    const sourcePixelsTooLarge = Boolean(sourceSize && sourceSize.width * sourceSize.height > RETOUCH_MAX_SOURCE_PIXELS)
    const derivedResolution = sourceSize
      ? retouchResolutionForSource(sourceSize.width, sourceSize.height)
      : resolution
    const needsUpscale = Boolean(keepSource && sourceSize
      && RETOUCH_TARGET_LONG_EDGE[resolution] < Math.max(sourceSize.width, sourceSize.height))
    const retouchOutput = retouch && sourceSize
      ? retouchOutputSize(sourceSize.width, sourceSize.height, resolution, keepSource)
      : undefined
    const tierOptions = resolutions.map(value => ({
      value,
      label: value.toUpperCase(),
      disabled: value === '4k' && !fourKAllowed,
      'aria-disabled': value === '4k' && !fourKAllowed ? true : undefined,
      title: value === '4k' && !fourKAllowed ? t('params.fourKUnsupportedRatio') : undefined,
    }))
    const requested = requestedResolution ?? resolution
    // 比例不在 4K 白名单只说明 4K 选项不可用。精修的「按 2K 生成」仅在用户要了 4K、
    // 有效档已经落到 2K 时出现；正常 1K/2K 与保持原尺寸没有发生这次回退。
    const showFourKFallback = !fourKAllowed && !keepSource && (!retouch || (requested === '4k' && resolution === '2k'))
    const resolutionOptions = retouch
      ? [...tierOptions, {
          value: 'source' as const,
          label: t('params.keepSourceSize'),
          disabled: !sourceSize || sourcePixelsTooLarge,
          'aria-disabled': !sourceSize || sourcePixelsTooLarge ? true : undefined,
          title: !sourceSize
            ? t('params.uploadSourceFirstTitle')
            : sourcePixelsTooLarge
              ? t('params.sourceTooLargeTitle')
              : undefined,
        }]
      : tierOptions
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
        <div style={labelStyle}>{resolutionLabel}</div>
        <Select
          aria-label={resolutionLabel}
          style={{ width: '100%' }}
          value={keepSource ? 'source' : resolution}
          disabled={disabled}
          onChange={value => {
            if (retouch && onRetouchOutputChange) {
              onRetouchOutputChange(value as '1k' | '2k' | '4k' | 'source')
              return
            }
            if (value !== 'source') onResolutionChange(value as '1k' | '2k' | '4k')
          }}
          options={resolutionOptions}
        />
        {mapped ? (
          <p className="toolbox-hint" role="status" aria-live="polite" style={{ margin: '8px 0 0', fontSize: 12 }}>
            {retouch && retouchOutput
              ? keepSource
                ? t('params.retouchOutputSource', { width: retouchOutput.width, height: retouchOutput.height, resolution: resolution.toUpperCase() })
                : t('params.retouchOutputTier', { width: retouchOutput.width, height: retouchOutput.height, resolution: resolution.toUpperCase() })
              : t('params.predictedOutput', { size: mapped.size, resolution: mapped.resolution.toUpperCase() })}
            {showFourKFallback
              ? t('params.fourKFallbackSuffix')
              : keepSource && needsUpscale
                ? derivedResolution === resolution
                  ? t('params.retouchUpscaleToSourceSameTier', { resolution: resolution.toUpperCase() })
                  : t('params.retouchUpscaleToSourceDiffTier', {
                      derived: derivedResolution.toUpperCase(),
                      resolution: resolution.toUpperCase(),
                    })
                : ''}
          </p>
        ) : null}
        {retouch && sourceSize && retouchOutput && !keepSource && Math.max(sourceSize.width, sourceSize.height) < 1024 ? (
          <p className="toolbox-hint" style={{ margin: '4px 0 0', fontSize: 12 }}>
            {t('params.retouchUpscaleNotice', {
              sourceWidth: sourceSize.width,
              sourceHeight: sourceSize.height,
              targetWidth: retouchOutput.width,
              targetHeight: retouchOutput.height,
            })}
          </p>
        ) : null}
      </div>
    )
    const variationQuickFill = variation ? (
      <div className="workstation-variation-quickfill">
        <div style={{ ...labelStyle, marginBottom: 0 }}>{t('params.quickFillLabel')}</div>
        <div className="workstation-prompt-templates workstation-variation-templates" role="group" aria-label={t('params.variationTemplatesAria')}>
          {VARIATION_TEMPLATE_KEYS.map(template => {
            const templatePrompt = t(template.promptKey)
            return (
              <Button
                key={template.id}
                size="small"
                disabled={disabled}
                onClick={() => {
                  const current = smartEditPrompt.trim()
                  const next = current ? `${current}${t('common.semicolon')}${templatePrompt}` : templatePrompt
                  onSmartEditPromptChange(next.slice(0, promptMaxLength))
                  setVariationNoteOpen(true)
                }}
              >
                {t(template.labelKey)}
              </Button>
            )
          })}
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
            {t('params.restoreLastPrompt')}
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
          <span>{variationNoteExpanded ? t('params.variationNoteOpen') : t('params.variationNoteClosed')}</span>
          <DownOutlined rotate={variationNoteExpanded ? 180 : 0} aria-hidden="true" />
        </button>
        {variationNoteExpanded ? (
          <Input.TextArea
            id="variation-note"
            value={smartEditPrompt}
            disabled={disabled}
            onChange={(event) => onSmartEditPromptChange(event.target.value)}
            placeholder={t('params.variationNotePlaceholder')}
            autoSize={{ minRows: 2, maxRows: 3 }}
            maxLength={promptMaxLength}
            aria-label={t('params.variationNoteAria')}
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
          <span>{fusionNoteExpanded ? t('params.optionalNoteLabel') : t('params.addOptionalNoteLabel')}</span>
          <DownOutlined rotate={fusionNoteExpanded ? 180 : 0} aria-hidden="true" />
        </button>
        {fusionNoteExpanded ? (
          <Input.TextArea
            id="fusion-note"
            value={smartEditPrompt}
            disabled={disabled}
            onChange={(event) => onSmartEditPromptChange(event.target.value)}
            placeholder={t('params.fusionNotePlaceholder')}
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={promptMaxLength}
            aria-label={t('params.optionalNoteAria')}
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
          placeholder={retouch ? t('params.retouchNotePlaceholder') : t('params.smartEditPlaceholder')}
          autoSize={retouch ? { minRows: 3, maxRows: 6 } : { minRows: 4, maxRows: 8 }}
          styles={promptMinHeight ? { textarea: { minHeight: promptMinHeight } } : undefined}
          style={promptMinHeight ? { minHeight: promptMinHeight } : undefined}
          maxLength={promptMaxLength}
          aria-labelledby="workstation-prompt-label"
          aria-required={promptRequired || undefined}
          showCount
        />
        {promptRequired ? (
          <div className="workstation-prompt-templates" role="group" aria-label={t('params.smartEditTemplatesAria')}>
            {SMART_EDIT_TEMPLATE_KEYS.map(template => {
              const templatePrompt = t(template.promptKey)
              return (
                <Button
                  key={template.id}
                  size="small"
                  disabled={disabled}
                  onClick={() => {
                    const current = smartEditPrompt.trim()
                    const next = current ? `${current}${t('common.semicolon')}${templatePrompt}` : templatePrompt
                    onSmartEditPromptChange(next.slice(0, promptMaxLength))
                  }}
                >
                  {t(template.labelKey)}
                </Button>
              )
            })}
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
            <div style={labelStyle}>{t('params.modelLabel')}</div>
            <ModelChoice
              ariaLabel={t('params.modelLabel')}
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
            <RetouchContract />
            <fieldset className="retouch-direction-fieldset" aria-describedby="retouch-direction-summary">
              <legend style={{ ...labelStyle, marginTop: 12 }} className="retouch-direction-legend">
                {t('params.retouchDirectionsLegend')}<span className="param-required" aria-hidden="true">*</span>
                <span className="sr-only">{t('params.requiredSrOnly')}</span>
              </legend>
              <button
                type="button"
                className={`retouch-preset${presetActive ? ' is-active' : ''}`}
                aria-pressed={presetActive}
                disabled={disabled}
                onClick={() => onRetouchDirectionsChange?.(normalizeRetouchDirections(retouchPreset.directions))}
              >
                <span className="retouch-preset-main">
                  <span className="retouch-preset-name">{t('retouch.presets.standard.label')}</span>
                  <span className="retouch-preset-badge">{t('params.recommendedBadge')}</span>
                </span>
                <span className="retouch-preset-desc">{t('retouch.presets.standard.description')}</span>
              </button>
              <div className="retouch-direction-summary">
                <span id="retouch-direction-summary" className="retouch-direction-selected" aria-live="polite">
                  {selectedDirections.length === 0
                    ? t('params.retouchSelectAtLeastOne')
                    : selectedDirections.length === RETOUCH_DIRECTIONS.length
                      ? t('params.retouchAllSelected', { count: RETOUCH_DIRECTIONS.length })
                      : t('params.retouchSelectedSummary', { directions: selectedDirectionLabel })}
                </span>
                <span className="retouch-direction-actions">
                  <button
                    type="button"
                    disabled={disabled || selectedDirections.length === RETOUCH_DIRECTIONS.length}
                    onClick={() => onRetouchDirectionsChange?.(normalizeRetouchDirections(RETOUCH_DIRECTIONS.map(item => item.id)))}
                  >
                    {t('params.selectAll')}
                  </button>
                  <button
                    type="button"
                    disabled={disabled || selectedDirections.length === 0}
                    onClick={() => onRetouchDirectionsChange?.([])}
                  >
                    {t('params.clearSelection')}
                  </button>
                </span>
              </div>
              <Checkbox.Group
                className="retouch-direction-group"
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                disabled={disabled}
                value={retouchDirections}
                onChange={(values) => onRetouchDirectionsChange?.(normalizeRetouchDirections(values.map(String)))}
                options={RETOUCH_DIRECTIONS.map(item => ({
                  value: item.id,
                  label: (
                    <span className="retouch-direction-option">
                      <span className="retouch-direction-name">{t(RETOUCH_DIRECTION_KEYS[item.id].label)}</span>
                      <span className="retouch-direction-hint">{t(RETOUCH_DIRECTION_KEYS[item.id].hint)}</span>
                    </span>
                  ),
                }))}
              />
            </fieldset>
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
            <div style={labelStyle}>{t('params.modelLabel')}</div>
            <ModelChoice
              ariaLabel={t('params.modelLabel')}
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
            <div style={labelStyle}>{t('relight.qualityLabel')}</div>
            <Segmented
              block
              aria-label={t('relight.qualityLabel')}
              disabled={disabled}
              value={relight.quality}
              onChange={(value) => update({ quality: value as RelightOptions['quality'] })}
              options={[
                { label: t('relight.qualities.soft'), value: 'soft' },
                { label: t('relight.qualities.hard'), value: 'hard' },
              ]}
            />
          </div>
          <div>
            <div style={labelStyle}>{t('relight.temperatureLabel')}</div>
            <Segmented
              block
              aria-label={t('relight.temperatureLabel')}
              disabled={disabled}
              value={relight.temperature}
              onChange={(value) => update({ temperature: value as RelightOptions['temperature'] })}
              options={[
                { label: t('relight.temperatures.warm'), value: 'warm' },
                { label: t('relight.temperatures.neutral'), value: 'neutral' },
                { label: t('relight.temperatures.cool'), value: 'cool' },
              ]}
            />
          </div>
        </div>
        <p className="toolbox-hint relight-quality-hint" style={{ margin: 0, fontSize: 12 }}>
          {t('relight.qualityHint')}
        </p>
        <div>
          {countHeading}
          <GenerationCountPicker value={count} max={maxCount} disabled={disabled} onChange={onCountChange} />
        </div>
        <div>
          <div className="relight-resolution-row">
            <div style={{ ...labelStyle, marginBottom: 0 }}>{t('params.renderResolutionLabel')}</div>
            <Select
              aria-label={t('params.renderResolutionLabel')}
              style={{ width: 120 }}
              value={resolution}
              disabled={disabled}
              onChange={onResolutionChange}
              options={resolutions.map(value => ({
                value,
                label: value.toUpperCase(),
                disabled: value === '4k' && !fourKAllowed,
                'aria-disabled': value === '4k' && !fourKAllowed ? true : undefined,
                title: value === '4k' && !fourKAllowed ? t('params.fourKUnsupportedRatio') : undefined,
              }))}
            />
          </div>
          {!fourKAllowed ? (
            <p className="toolbox-hint" style={{ margin: '6px 0 0', fontSize: 12 }}>
              {t('params.fourKFallbackSentence')}
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
            <span>{noteExpanded ? t('params.optionalNoteLabel') : t('params.addOptionalNoteLabel')}</span>
            <DownOutlined rotate={noteExpanded ? 180 : 0} aria-hidden="true" />
          </button>
          {noteExpanded ? (
            <Input.TextArea
              id="relight-note"
              value={smartEditPrompt}
              disabled={disabled}
              onChange={(event) => onSmartEditPromptChange(event.target.value)}
              placeholder={t('params.relightNotePlaceholder')}
              autoSize={{ minRows: 3, maxRows: 6 }}
              styles={promptMinHeight ? { textarea: { minHeight: promptMinHeight } } : undefined}
              style={promptMinHeight ? { minHeight: promptMinHeight } : undefined}
              maxLength={noteMax}
              aria-label={t('params.optionalNoteAria')}
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
        <p className="toolbox-hint" style={{ margin: 0, fontSize: 12 }}>{t('relight.disclaimer')}</p>
      </Space>
    )
  }

  if (mode === 'repaint') {
    const promptMissing = hasMaskPaint && !repaintPrompt.trim()
    // 未涂抹的引导由上方状态块和步骤条负责，这里只解释描述的作用，避免同一句话出现四次。
    const repaintHint = promptMissing
      ? t('params.repaintPromptMissingHint')
      : t('params.repaintPromptHint')
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {intro}
        <div
          className={`workstation-inpaint-mask-status${hasMaskPaint ? ' is-ready' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="workstation-inpaint-mask-dot" aria-hidden="true" />
          <span>{hasMaskPaint ? t('params.repaintMaskReady') : t('params.repaintMaskEmpty')}</span>
        </div>
        <div>
          <label htmlFor={repaintPromptId} style={labelStyle}>
            {t('params.repaintPromptLabel')}<span className="param-required" aria-hidden="true">*</span>
          </label>
          <Input.TextArea
            id={repaintPromptId}
            aria-required="true"
            aria-describedby={repaintHintId}
            value={repaintPrompt}
            disabled={disabled}
            onChange={(event) => onRepaintPromptChange(event.target.value)}
            placeholder={t('params.repaintPromptPlaceholder')}
            autoSize={repaintPromptSize}
            maxLength={MAX_ERASE_PROMPT_LENGTH}
            showCount
          />
          <p id={repaintHintId} className={`workstation-inpaint-hint${promptMissing ? ' is-warning' : ''}`}>
            {repaintHint}
          </p>
        </div>
        <div>
          <div style={labelStyle}>{t('params.outputLabel')}</div>
          <dl className="workstation-inpaint-contract">
            <div>
              <dt>{t('params.modelLabel')}</dt>
              <dd>{t('params.inpaintModelLabel')}</dd>
            </div>
            <div>
              <dt>{t('params.sizeLabel')}</dt>
              <dd>{t('params.sameAsOriginalSize')}</dd>
            </div>
            <div>
              <dt>{t('params.countLabel')}</dt>
              <dd>{t('params.onePerRun')}</dd>
            </div>
            {inpaintCreditLabel ? (
              <div>
                <dt>{t('params.creditsLabel')}</dt>
                <dd>{inpaintCreditLabel}</dd>
              </div>
            ) : null}
          </dl>
          <p className="workstation-inpaint-contract-note">
            {t('params.repaintContractNote')}
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
            <span>{hasMaskPaint ? t('params.removeMaskReady') : t('params.removeMaskEmpty')}</span>
          </div>
          <div>
            <p className="toolbox-hint" style={{ margin: '0 0 8px', fontSize: 12 }}>{t('params.removeSmartSelectHint')}</p>
            <label htmlFor={erasePromptId} style={labelStyle}>{t('params.removePromptLabel')}</label>
            <Input.TextArea
              id={erasePromptId}
              value={erasePrompt}
              disabled={disabled}
              onChange={(event) => onErasePromptChange(event.target.value)}
              placeholder={t('params.removePromptPlaceholder')}
              autoSize={tallPromptSize}
              styles={promptMinHeight ? { textarea: { minHeight: promptMinHeight } } : undefined}
              style={promptMinHeight ? { minHeight: promptMinHeight } : undefined}
              maxLength={MAX_ERASE_PROMPT_LENGTH}
              showCount
            />
          </div>
          <div>
            <div style={labelStyle}>{t('params.outputLabel')}</div>
            <dl className="workstation-inpaint-contract">
              <div>
                <dt>{t('params.modelLabel')}</dt>
                <dd>{t('params.inpaintModelLabel')}</dd>
              </div>
              <div>
                <dt>{t('params.sizeLabel')}</dt>
                <dd>{t('params.sameAsOriginalSize')}</dd>
              </div>
              <div>
                <dt>{t('params.countLabel')}</dt>
                <dd>{t('params.onePerRun')}</dd>
              </div>
              {inpaintCreditLabel ? (
                <div>
                  <dt>{t('params.creditsLabel')}</dt>
                  <dd>{inpaintCreditLabel}</dd>
                </div>
              ) : null}
            </dl>
            <p className="workstation-inpaint-contract-note">
              {t('params.removeContractNote')}
            </p>
          </div>
        </>
      ) : null}
      {capability === Capability.Outpaint ? (
        <>
          <div>
            <div style={labelStyle}>{t('params.outpaint.targetLabel')}</div>
            <Segmented
              block
              aria-label={t('params.outpaint.targetLabel')}
              options={[
                { label: t('params.outpaint.modes.free'), value: 'free' },
                { label: t('params.outpaint.modes.platformRatio'), value: 'platform-ratio' },
                { label: t('params.outpaint.modes.platformSize'), value: 'platform-size' },
              ]}
              value={outpaintTarget}
              disabled={disabled}
              onChange={(value) => onOutpaintTargetModeChange(value as OutpaintTargetMode)}
            />
            <p className="toolbox-hint" style={{ margin: '8px 0 0', fontSize: 12 }}>
              {outpaintTarget === 'free'
                ? t('params.outpaint.modeHints.free')
                : outpaintTarget === 'platform-ratio'
                  ? t('params.outpaint.modeHints.platformRatio')
                  : t('params.outpaint.modeHints.platformSize')}
              {/* 尺寸变化用 polite 播报，键盘调整时读屏能听到新目标。 */}
              <span aria-live="polite">
                {' '}
                {sourceSize && outpaintTargetSize
                  ? t('params.outpaint.predictedSize', { width: outpaintTargetSize.width, height: outpaintTargetSize.height })
                  : t('params.outpaint.uploadToShowSize')}
              </span>
            </p>
          </div>
          {outpaintTarget === 'free' && sourceSize && outpaintTargetSize ? (
            <div>
              <div style={labelStyle}>{t('params.outpaint.freeSizeLabel')}</div>
              <div className="workstation-outpaint-size">
                <Button
                  className="workstation-outpaint-step"
                  size="small"
                  aria-label={t('params.outpaint.decreaseSize')}
                  title={t('params.outpaint.decreaseSize')}
                  icon={<MinusOutlined aria-hidden="true" />}
                  disabled={disabled || !canStepOutpaintDown}
                  onClick={() => stepOutpaintSize(-1)}
                />
                <InputNumber
                  aria-label={t('params.outpaint.targetWidthAria')}
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
                  aria-label={t('params.outpaint.targetHeightAria')}
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
                  aria-label={t('params.outpaint.increaseSize')}
                  title={t('params.outpaint.increaseSize')}
                  icon={<PlusOutlined aria-hidden="true" />}
                  disabled={disabled || !canStepOutpaintUp}
                  onClick={() => stepOutpaintSize(1)}
                />
              </div>
              <p className="toolbox-hint" style={{ margin: '6px 0 0', fontSize: 12 }}>
                {t('params.outpaint.maxScaleHint', { maxScale: MAX_SCALE })}
              </p>
            </div>
          ) : null}
          {outpaintTarget !== 'free' ? (
            <div>
              <div style={labelStyle}>{t('params.outpaint.platformLabel')}</div>
              <Select
                aria-label={t('params.outpaint.platformLabel')}
                style={{ width: '100%' }}
                value={presetPlatform}
                disabled={disabled}
                onChange={onPresetPlatformChange}
                options={PLATFORM_SIZE_PRESETS.map((preset) => {
                  const key = (PLATFORM_LABEL_KEYS as Record<string, PlatformLabelKey | undefined>)[preset.id]
                  const platformLabel = key ? t(key) : preset.label
                  return {
                    value: preset.platform,
                    label: outpaintTarget === 'platform-size'
                      ? t('params.outpaint.platformSizeOption', {
                          platform: platformLabel,
                          width: preset.width,
                          height: preset.height,
                        })
                      : t('params.outpaint.platformRatioOption', { platform: platformLabel }),
                  }
                })}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </Space>
  )
}
