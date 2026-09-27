import { Component, type ReactNode } from 'react'
import { Button, Result } from 'antd'
import { clearChunkReloadMark, isChunkLoadError, reloadOnceForChunkError } from '@/utils/chunkLoadError'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  chunkError: boolean
}

/**
 * 包裹在 Content 区域外层，某个页面渲染报错时只有内容区变成错误提示，
 * 导航栏依然可用，用户能直接切换到其他模块，而不是整个应用白屏。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, chunkError: false }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, chunkError: isChunkLoadError(error) }
  }

  componentDidCatch(error: unknown) {
    if (isChunkLoadError(error) && reloadOnceForChunkError()) return
    console.error('页面渲染出错：', error)
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (prevState.hasError && !this.state.hasError) clearChunkReloadMark()
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="页面出了点问题"
          subTitle={this.state.chunkError
            ? '页面资源已更新，刷新后即可继续使用'
            : '可以尝试刷新，如果持续出现请反馈给开发同学'}
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          }
        />
      )
    }
    return this.props.children
  }
}
