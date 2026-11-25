import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('canvas')
  const unavailable = disabled || importing
  return (
    <Tooltip title={t('addImage.label')}>
      <span className="free-canvas-add-image">
        <Dropdown
          trigger={['click']}
          placement="bottomRight"
          disabled={unavailable}
          menu={{
            items: [
              { key: 'local', label: t('addImage.localUpload'), disabled: unavailable },
              { key: 'asset', label: t('addImage.fromAssets'), disabled: unavailable },
            ],
            onClick: ({ key }) => {
              if (unavailable) return
              if (key === 'local') onUpload()
              if (key === 'asset') onPickAsset()
            },
          }}
        >
          <Button aria-label={t('addImage.label')} icon={<PlusOutlined />} loading={importing} disabled={disabled}>
            <span className="free-canvas-add-label">{t('addImage.label')}</span>
          </Button>
        </Dropdown>
      </span>
    </Tooltip>
  )
}
