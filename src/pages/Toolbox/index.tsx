import { lazy, Suspense } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Segmented, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { TOOLBOX_TOOLS } from './tools'

const WatermarkTool = lazy(() => import('./WatermarkTool'))

export default function Toolbox() {
  const { tool } = useParams<{ tool: string }>()
  const navigate = useNavigate()
  const activeSlug = TOOLBOX_TOOLS.find((t) => t.slug === tool)?.slug ?? TOOLBOX_TOOLS[0].slug

  return (
    <div>
      <Segmented
        options={TOOLBOX_TOOLS.map((t) => ({ label: t.label, value: t.slug }))}
        value={activeSlug}
        onChange={(v) => navigate(`/toolbox/${v}`)}
      />

      {activeSlug === 'watermark' ? <Suspense fallback={<div style={{ marginTop: 20 }}>正在加载加水印工具…</div>}><WatermarkTool /></Suspense> : (
        <>
          <Upload.Dragger multiple style={{ marginTop: 16 }} beforeUpload={() => false}>
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p>拖拽图片或点击上传，支持批量</p>
          </Upload.Dragger>
          <div style={{ marginTop: 16 }}>
            {activeSlug === 'bg-remove' && <div>参数：输出背景（透明 / 白底 / 纯色）</div>}
            {activeSlug === 'aspect-ratio' && <div>参数：目标平台（单选）、适配策略（智能裁剪 / 智能扩展 / 留白填充）</div>}
          </div>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button>打包下载</Button>
            <Button type="primary">开始处理</Button>
          </div>
        </>
      )}
    </div>
  )
}
