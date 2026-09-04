import { useNavigate, useParams } from 'react-router-dom'
import { Button, Segmented, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { TOOLBOX_TOOLS } from './tools'

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

      <Upload.Dragger multiple style={{ marginTop: 16 }} beforeUpload={() => false}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p>拖拽图片或点击上传，支持批量</p>
      </Upload.Dragger>

      {/* TODO: 缩略图网格 + 每张图的处理状态标记 */}

      <div style={{ marginTop: 16 }}>
        {activeSlug === 'bg-remove' && <div>参数：输出背景（透明 / 白底 / 纯色）</div>}
        {activeSlug === 'watermark' && <div>参数：水印类型、位置、透明度、大小（设置一次，应用到全部）</div>}
        {activeSlug === 'aspect-ratio' && <div>参数：目标平台（可多选）、适配策略（智能裁剪 / 智能扩展 / 留白填充）</div>}
      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button>打包下载</Button>
        <Button type="primary">开始处理</Button>
      </div>
    </div>
  )
}
