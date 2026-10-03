import { Switch } from 'antd'
import { useUserStore } from '@/store/useUserStore'

export default function VideoGenerationSettings({ generateAudio, onAudioChange, disabled, loading, configured, credits, mockGateway }: {
  generateAudio: boolean; onAudioChange?: (value: boolean) => void; disabled: boolean; loading: boolean;
  configured: boolean; credits?: number; mockGateway: boolean;
}) {
  const balance = useUserStore(state => state.credits)
  return <>
    <p>Seedance 2.0 fast · 720p · 每次 1 条</p>
    <label className="free-canvas-field"><span>生成声音</span><Switch aria-label="生成声音" checked={generateAudio} disabled={disabled} onChange={onAudioChange} /></label>
    {loading ? <p role="status">正在加载视频配置…</p>
      : !configured ? <p role="status">视频生成尚未开放，请检查登录与服务配置。</p>
      : <p>{mockGateway ? '模拟生成，不消耗积分' : `本次预计预扣 ${credits} 积分，余额 ${balance} 积分；视频保存完成后结算，失败退款。`}</p>}
    <p>生成结果保留 30 天，请及时下载。有声和无声同价。</p>
  </>
}
