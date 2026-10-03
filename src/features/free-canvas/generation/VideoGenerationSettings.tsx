import { Switch } from 'antd'

export default function VideoGenerationSettings({ generateAudio, onAudioChange, disabled, loading, configured }: {
  generateAudio: boolean; onAudioChange?: (value: boolean) => void; disabled: boolean; loading: boolean;
  configured: boolean;
}) {
  return <>
    <p>Seedance 2.0 fast · 720p · 每次 1 条</p>
    <label className="free-canvas-field free-canvas-switch-field"><span>生成声音</span><Switch aria-label="生成声音" checked={generateAudio} disabled={disabled} onChange={onAudioChange} /></label>
    {loading ? <p role="status">正在加载视频配置…</p> : null}
    {!loading && !configured ? <p role="status">视频生成尚未开放，请检查登录与服务配置。</p> : null}
    <p>生成结果保留 30 天，请及时下载。有声和无声同价。</p>
  </>
}
