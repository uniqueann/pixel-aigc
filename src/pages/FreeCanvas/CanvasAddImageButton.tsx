import { PlusOutlined } from '@ant-design/icons'
import { Button, Dropdown, Tooltip } from 'antd'

export default function CanvasAddImageButton({
  importing,
  disabled,
  onUpload,
  onPickAsset,
}: {
  importing: boolean
  disabled: boolean
  onUpload: () => void
  onPickAsset: () => void
}) {
  const unavailable = disabled || importing
  return (
    <Tooltip title="添加图片">
      <span className="free-canvas-add-image">
        <Dropdown
          trigger={['click']}
          placement="bottomRight"
          disabled={unavailable}
          menu={{
            items: [
              { key: 'local', label: '本地上传', disabled: unavailable },
              { key: 'asset', label: '从我的资产', disabled: unavailable },
            ],
            onClick: ({ key }) => {
              if (unavailable) return
              if (key === 'local') onUpload()
              if (key === 'asset') onPickAsset()
            },
          }}
        >
          <Button aria-label="添加图片" icon={<PlusOutlined />} loading={importing} disabled={disabled}>
            <span className="free-canvas-add-label">添加图片</span>
          </Button>
        </Dropdown>
      </span>
    </Tooltip>
  )
}
