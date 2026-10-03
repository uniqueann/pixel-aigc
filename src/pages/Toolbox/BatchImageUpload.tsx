import { InboxOutlined } from '@ant-design/icons'
import { Upload } from 'antd'

interface Props {
  count: number
  disabled: boolean
  onAdd: (file: File) => void
  processingHint?: string
}

export default function BatchImageUpload({ count, disabled, onAdd, processingHint = '图片仅在本机处理' }: Props) {
  return (
    <section className="toolbox-upload-panel" aria-label="上传图片">
      <div className="toolbox-section-heading">
        <div><strong>上传图片</strong><span>{count} / 20 张</span></div>
      </div>
      <Upload.Dragger
        className="toolbox-upload"
        accept="image/jpeg,image/png,image/webp"
        multiple
        showUploadList={false}
        disabled={disabled}
        beforeUpload={(file) => { onAdd(file); return Upload.LIST_IGNORE }}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p>拖入图片，或点击选择</p>
        <p className="ant-upload-hint">静态 JPG / PNG / WebP，最多 20 张；{processingHint}</p>
      </Upload.Dragger>
      <p className="toolbox-hint">单张最多 20 MB，整批最多 150 MB；桌面设备最多 24 MP，触屏设备最多 12 MP。</p>
    </section>
  )
}
