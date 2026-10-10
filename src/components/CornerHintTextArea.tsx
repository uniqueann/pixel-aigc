import { Input } from 'antd'
import type { TextAreaProps } from 'antd/es/input'

/**
 * 多行文本框：把 placeholder 提示文字放到文本框内部右下角（而不是默认的左上角）。
 *
 * - 空值时显示，输入后隐藏（与原生 placeholder 语义一致）；
 * - 原生 placeholder 属性保留（透明隐藏），无障碍朗读与无样式降级时仍可用；
 * - 提示层 pointer-events: none，点击穿透聚焦到输入框；
 * - 带 showCount 时提示上移，给 antd 的字数统计让位。
 */
export function CornerHintTextArea({ placeholder, value, showCount, className, ...rest }: TextAreaProps) {
  const isEmpty = value === undefined || value === null || value === ''
  const wrapClass = ['corner-hint-textarea']
  if (showCount) wrapClass.push('corner-hint-textarea--with-count')
  if (className) wrapClass.push(className)
  return (
    <span className={wrapClass.join(' ')}>
      <Input.TextArea {...rest} value={value} showCount={showCount} placeholder={placeholder} />
      {isEmpty && placeholder ? (
        <span className="corner-hint-textarea-hint" aria-hidden="true">
          {placeholder}
        </span>
      ) : null}
    </span>
  )
}
