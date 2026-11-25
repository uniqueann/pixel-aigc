import { Radio, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import ModelChoice, { type ModelChoiceOption } from '@/components/ModelChoice'
import { videoModelAvailableForMode, videoModelResolutions, type VideoMode, type VideoModelProfile, type VideoResolution } from '@shared/video-models'

export default function VideoGenerationSettings({ generateAudio, onAudioChange, disabled, loading, configured,
  model, models, resolution, selectedId, onModelChange, onResolutionChange, mode = 'text_to_video' }: {
  generateAudio: boolean; onAudioChange?: (value: boolean) => void; disabled: boolean; loading: boolean;
  configured: boolean;
  model?: VideoModelProfile; models?: VideoModelProfile[]; resolution?: VideoResolution; selectedId?: string
  onModelChange?: (id: string) => void; onResolutionChange?: (resolution: VideoResolution) => void
  mode?: VideoMode
}) {
  const { t } = useTranslation('canvas')
  const choices: ModelChoiceOption[] = models?.map(item => ({ ...item, disabled: !videoModelAvailableForMode(item, mode) })) ?? []
  const available = videoModelAvailableForMode(model, mode)
  if (selectedId && !choices.some(item => item.id === selectedId)) choices.push({ id: selectedId, label: t('video.settings.modelUnavailableOption'), disabled: true })
  return <>
    {models && <ModelChoice className="free-canvas-field" label={t('video.settings.modelLabel')} ariaLabel={mode === 'image_to_video' ? t('video.settings.imageToVideoAria') : t('video.settings.textToVideoAria')} models={choices}
      value={selectedId ?? model?.id} loading={loading} disabled={disabled} onChange={onModelChange} placeholder={t('video.settings.selectPlaceholder')} />}
    {model && onResolutionChange && <label className="free-canvas-field"><span>{t('video.settings.resolutionLabel')}</span>
      <Radio.Group aria-label={t('video.settings.resolutionLabel')} value={resolution ?? model.resolution} disabled={disabled || !available}
        onChange={event => onResolutionChange(event.target.value)}>
        {videoModelResolutions(model).map(value => <Radio.Button key={value} value={value}>{value.toUpperCase()}</Radio.Button>)}
      </Radio.Group></label>}
    <p>{model?.label ?? t('video.settings.defaultModelName')}{model ? ` · ${(resolution ?? model.resolution).toUpperCase()}` : ''} · {t('video.settings.perRunCount')}</p>
    {((model && !available) || (selectedId && !model)) && <p role="status">{t('video.settings.modelUnavailableNotice')}</p>}
    {model?.audioMode === 'native' ? <p>{t('video.settings.nativeAudio')}</p> : <label className="free-canvas-field free-canvas-switch-field"><span>{t('video.settings.generateAudio')}</span><Switch aria-label={t('video.settings.generateAudio')} checked={generateAudio} disabled={disabled || model?.supportsAudio === false} onChange={onAudioChange} /></label>}
    {loading ? <p role="status">{t('video.settings.loadingConfig')}</p> : null}
    {!loading && !configured ? <p role="status">{t('video.availability.soon')}</p> : null}
    <p>{t('video.settings.retentionNotice', { audioNote: model?.audioMode === 'native' ? t('video.settings.nativeAudioNote') : t('video.settings.optionalAudioNote') })}</p>
  </>
}
