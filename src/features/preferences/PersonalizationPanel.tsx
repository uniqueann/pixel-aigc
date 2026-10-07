import { useState } from 'react'
import { App, Button, Popconfirm, Select, Space, Switch } from 'antd'
import { defaultImageModel } from '@shared/image-models'
import { COUNT_TOOLS, type CountTool } from '@shared/preferences'
import { usePreferencesStore } from './store'
import { clearSidebarState } from './storage'
import { CLEAR_IMAGE_MEMORY_SUCCESS_DURATION, clearImageMemoryFailureMessage } from './errors'
import PreferencesSyncAlert from './PreferencesSyncAlert'

const toolLabels: Record<CountTool, string> = { 'smart-edit': '智能编辑', relight: '打光', variation: '裂变', fusion: '融合', retouch: '精修' }
const startPages = [
  { value: '/', label: '工作台首页' }, { value: '/email', label: '邮件助手' },
  { value: '/image-workstation', label: '图片工作站' }, { value: '/toolbox', label: '工具箱' },
  { value: '/canvas', label: '自由画布' }, { value: '/assets', label: '我的资产' },
  { value: 'last', label: '上次访问页面' },
]

function PreferenceRow({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return <div className="setting-row"><span><strong>{label}</strong><small>{detail}</small></span><div className="preference-control">{children}</div></div>
}

export default function PersonalizationPanel() {
  const preferences = usePreferencesStore(state => state.preferences)
  const status = usePreferencesStore(state => state.status)
  const update = usePreferencesStore(state => state.update)
  const { message } = App.useApp()
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const { workbench, image, email } = preferences
  const hasMemory = Object.keys(image.lastUsed).length > 0
  const statusText = status === 'saving' ? '正在同步…' : status === 'saved' ? '已同步到账号' : status === 'local' ? '已保存到本机' : status === 'loading' ? '正在加载…' : '尚未同步'
  const canClear = hasMemory || status === 'error' || Boolean(clearError)
  async function clearImageMemory() {
    setClearing(true)
    try {
      await usePreferencesStore.getState().clearImageMemory()
      setClearError(null)
      message.success({ content: '已清除图片参数记忆', duration: CLEAR_IMAGE_MEMORY_SUCCESS_DURATION })
    } catch (caught) {
      const text = clearImageMemoryFailureMessage(caught)
      setClearError(text)
      message.error(text)
    } finally {
      setClearing(false)
    }
  }
  return <section className="personalization-panel">
    <h2>个性化</h2>
    <p className="settings-description">按你的习惯打开页面、处理图片和编写邮件。账号偏好可跨设备同步。</p>
    <div className="preferences-sync-status" role="status" aria-live="polite">{statusText}</div>
    <PreferencesSyncAlert className="preferences-panel-error" />

    <h3 className="preferences-group-title">工作台习惯</h3>
    <div className="settings-rows">
      <PreferenceRow label="默认打开页面" detail="首次打开工作台时进入的页面，直接访问链接优先">
        <Select aria-label="默认打开页面" value={workbench.startPage} options={startPages} onChange={startPage => update({ workbench: { startPage } })} />
      </PreferenceRow>
      <PreferenceRow label="记住侧边栏状态" detail="展开和收起状态保留在当前设备，手机端自动收起">
        <Switch aria-label="记住侧边栏状态" checked={workbench.rememberSidebar} onChange={rememberSidebar => update({ workbench: { rememberSidebar } })} />
      </PreferenceRow>
      <PreferenceRow label="资产展示方式" detail="默认展示方式；选择记住上次时，资产页切换会同步到账号">
        <Select aria-label="资产展示方式" value={workbench.assetsView} options={[{ value: 'grid', label: '网格' }, { value: 'list', label: '列表' }, { value: 'remember', label: '记住上次选择' }]} onChange={assetsView => update({ workbench: { assetsView } })} />
      </PreferenceRow>
    </div>

    <h3 className="preferences-group-title">图片处理</h3>
    <div className="settings-rows">
      <PreferenceRow label="默认生成数量" detail="各工具独立设置。修改后会清掉该工具记住的张数并立即生效；模型能力或图片比例受限时仍会自动调整">
        <div className="preferences-counts">
          {COUNT_TOOLS.map(tool => {
            const max = defaultImageModel(tool === 'variation' ? 'variation' : 'image_edit')?.ui.maxCount ?? 4
            return <label key={tool}><span>{toolLabels[tool]}</span><Select aria-label={`${toolLabels[tool]}默认生成数量`} value={image.counts[tool]} options={Array.from({ length: max }, (_, i) => ({ value: i + 1, label: `${i + 1} 张` }))} onChange={value => update({ image: { counts: { [tool]: value } } })} /></label>
          })}
        </div>
      </PreferenceRow>
      <PreferenceRow label="默认分辨率" detail="用于支持分辨率设置的图片工作站工具">
        <Select aria-label="默认分辨率" value={image.resolution} options={(defaultImageModel('image_edit')?.ui.resolutions ?? ['2k']).map(value => ({ value, label: value.toUpperCase() }))} onChange={resolution => update({ image: { resolution } })} />
      </PreferenceRow>
      <PreferenceRow label="记住上次参数" detail="开启时优先使用各工具上次参数；关闭时使用默认数量、分辨率和工具初始设置">
        <Switch aria-label="记住上次参数" checked={image.rememberParameters} onChange={rememberParameters => update({ image: { rememberParameters } })} />
      </PreferenceRow>
    </div>
    <div className="preferences-memory-actions">
      <p>记忆范围为图片工作站和工具箱的可复用参数。上传文件、提示词、遮罩和结果由当前任务管理。</p>
      <div className="preferences-clear-actions">
        <Popconfirm title="清除图片参数记忆？" description="下次进入工具时将使用个人默认值。" okText="清除" cancelText="取消" getPopupContainer={() => document.body} onConfirm={() => clearImageMemory()}>
          <Button size="small" loading={clearing} disabled={!canClear || clearing}>清除图片参数记忆</Button>
        </Popconfirm>
        {clearError ? (
          <>
            <button type="button" className="preferences-clear-retry" disabled={clearing} onClick={() => void clearImageMemory()}>重试</button>
            <span className="preferences-clear-error" role="alert">{clearError}</span>
          </>
        ) : null}
      </div>
    </div>

    <h3 className="preferences-group-title">邮件助手</h3>
    <div className="settings-rows">
      <PreferenceRow label="默认输出语言" detail="新邮件任务的输出语言，与界面语言分开">
        <Select aria-label="默认输出语言" value={email.language} options={[{ value: 'zh', label: '中文' }, { value: 'en', label: '英文' }, { value: 'ja', label: '日文' }]} onChange={language => update({ email: { language } })} />
      </PreferenceRow>
      <PreferenceRow label="默认操作" detail="新任务默认使用的处理方式">
        <Select aria-label="默认操作" value={email.operation} options={[{ value: 'reply', label: '回复' }, { value: 'summarize', label: '总结' }, { value: 'polish', label: '润色' }, { value: 'grammar', label: '检查语法' }]} onChange={operation => update({ email: { operation } })} />
      </PreferenceRow>
      <PreferenceRow label="默认润色方式" detail="选择润色操作时使用，可多选">
        <Select aria-label="默认润色方式" mode="multiple" value={email.polishStyles} options={[{ value: 'clear', label: '提升清晰度' }, { value: 'shorten', label: '缩短' }, { value: 'lengthen', label: '增长' }, { value: 'simplify', label: '简化' }]} onChange={polishStyles => update({ email: { polishStyles } })} />
      </PreferenceRow>
    </div>
    <div className="preferences-footer">
      <span>自动保存。默认生成数量会覆盖该工具记住的张数；其它默认参数在下次进入工具或新建任务时生效。</span>
      <Space><Popconfirm title="恢复全部个性化默认设置？" description="同时清除图片参数记忆，并同步到当前账号。" okText="恢复默认" cancelText="取消" onConfirm={() => {
        clearSidebarState(usePreferencesStore.getState().owner)
        usePreferencesStore.getState().reset()
      }}><Button>恢复默认</Button></Popconfirm></Space>
    </div>
  </section>
}
