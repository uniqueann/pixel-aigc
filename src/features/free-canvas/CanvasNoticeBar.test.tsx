// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CanvasNoticeBar, { type CanvasNotice } from './CanvasNoticeBar'

const notices: CanvasNotice[] = [
  { key: 'a', level: 'warning', message: '生成请求等待恢复', description: '继续操作会使用原幂等键' },
  { key: 'b', level: 'warning', message: '模型配置读取失败', description: '功能配置加载失败', actions: [{ key: 'reload', label: '重新读取', onClick: () => {} }] },
  { key: 'c', level: 'info', message: '视频画布暂时仅支持本地保存' },
]

afterEach(cleanup)

describe('CanvasNoticeBar', () => {
  it('默认只露出第一条提示，其余折叠为计数', () => {
    render(<CanvasNoticeBar notices={notices} />)
    expect(screen.getByText('生成请求等待恢复')).toBeTruthy()
    expect(screen.queryByText('模型配置读取失败')).not.toBeTruthy()
    expect(screen.getByRole('button', { name: '还有 2 项提示' })).toBeTruthy()
  })

  it('展开后显示全部提示与各自操作', () => {
    const onClick = vi.fn()
    render(<CanvasNoticeBar notices={[notices[0], { ...notices[1], actions: [{ key: 'reload', label: '重新读取', onClick }] }]} />)
    fireEvent.click(screen.getByRole('button', { name: '还有 1 项提示' }))
    expect(screen.getByText('模型配置读取失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '收起提示' }))
    expect(screen.queryByText('模型配置读取失败')).not.toBeTruthy()
  })

  it('只有一条提示时不出现展开按钮', () => {
    render(<CanvasNoticeBar notices={[notices[0]]} />)
    expect(screen.queryByRole('button')).not.toBeTruthy()
  })

  it('没有提示时不渲染状态区', () => {
    const { container } = render(<CanvasNoticeBar notices={[]} />)
    expect(container.childElementCount).toBe(0)
  })
})
