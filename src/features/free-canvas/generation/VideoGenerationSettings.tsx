import { Radio, Switch } from 'antd'
import ModelChoice, { type ModelChoiceOption } from '@/components/ModelChoice'
import { videoModelResolutions, type VideoModelProfile, type VideoResolution } from '@shared/video-models'

export default function VideoGenerationSettings({ generateAudio, onAudioChange, disabled, loading, configured,
  model, models, resolution, selectedId, onModelChange, onResolutionChange }: {
  generateAudio: boolean; onAudioChange?: (value: boolean) => void; disabled: boolean; loading: boolean;
  configured: boolean;
  model?: VideoModelProfile; models?: VideoModelProfile[]; resolution?: VideoResolution; selectedId?: string
  onModelChange?: (id: string) => void; onResolutionChange?: (resolution: VideoResolution) => void
}) {
  const choices: ModelChoiceOption[] = models?.map(item => ({ ...item, disabled: item.available === false })) ?? []
  if (selectedId && !choices.some(item => item.id === selectedId)) choices.push({ id: selectedId, label: '原视频模型暂不可用', disabled: true })
  return <>
    {models && <ModelChoice className="free-canvas-field" label="生成模型" ariaLabel="文生视频模型" models={choices}
      value={selectedId ?? model?.id} loading={loading} disabled={disabled} onChange={onModelChange} placeholder="请选择视频模型" />}
    {model && onResolutionChange && <label className="free-canvas-field"><span>视频分辨率</span>
      <Radio.Group aria-label="视频分辨率" value={resolution ?? model.resolution} disabled={disabled || model.available === false}
        onChange={event => onResolutionChange(event.target.value)}>
        {videoModelResolutions(model).map(value => <Radio.Button key={value} value={value}>{value.toUpperCase()}</Radio.Button>)}
      </Radio.Group></label>}
    <p>{model?.label ?? '视频模型'}{model ? ` · ${(resolution ?? model.resolution).toUpperCase()}` : ''} · 每次 1 条</p>
    {(model?.available === false || (selectedId && !model)) && <p role="status">原视频模型暂不可用，请手动选择其他模型后生成。</p>}
    <label className="free-canvas-field free-canvas-switch-field"><span>生成声音</span><Switch aria-label="生成声音" checked={generateAudio} disabled={disabled || model?.supportsAudio === false} onChange={onAudioChange} /></label>
    {loading ? <p role="status">正在加载视频配置…</p> : null}
    {!loading && !configured ? <p role="status">视频生成即将上线。</p> : null}
    <p>生成结果保留 30 天，请及时下载；开启声音不额外收取费用。</p>
  </>
}
