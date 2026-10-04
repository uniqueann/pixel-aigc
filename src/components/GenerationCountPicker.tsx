import { Radio } from 'antd'

interface Props {
  value: number
  max: number
  disabled?: boolean
  onChange?: (count: number) => void
  label?: string
}

/** 离散张数选择。工作站和自由画布共用，避免滑块刻度在窄面板里溢出。 */
export default function GenerationCountPicker({ value, max, disabled = false, onChange, label = '生成数量' }: Props) {
  const limit = Math.max(1, Math.floor(max))
  const current = Math.min(Math.max(1, value), limit)
  return (
    <div className="generation-count-picker" role="radiogroup" aria-label={label}>
      <Radio.Group
        buttonStyle="solid"
        value={current}
        disabled={disabled}
        onChange={event => onChange?.(Number(event.target.value))}
      >
        {Array.from({ length: limit }, (_, index) => {
          const count = index + 1
          return <Radio.Button key={count} value={count}>{count}</Radio.Button>
        })}
      </Radio.Group>
    </div>
  )
}
