import { Component, type ReactNode } from 'react'
import { Button, Result } from 'antd'
import { withTranslation, type WithTranslation } from 'react-i18next'
import { clearChunkReloadMark, isChunkLoadError, reloadOnceForChunkError } from '@/utils/chunkLoadError'

interface Props extends WithTranslation<'common'> {
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
class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { hasError: false, chunkError: false }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, chunkError: isChunkLoadError(error) }
  }

  componentDidCatch(error: unknown) {
    if (isChunkLoadError(error) && reloadOnceForChunkError()) return
    console.error('Page render error:', error)
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (prevState.hasError && !this.state.hasError) clearChunkReloadMark()
  }

  render() {
    const { t } = this.props
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title={t('errorBoundary.title')}
          subTitle={this.state.chunkError
            ? t('errorBoundary.chunkUpdated')
            : t('errorBoundary.genericSubTitle')}
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              {t('actions.refreshPage')}
            </Button>
          }
        />
      )
    }
    return this.props.children
  }
}

const ErrorBoundary = withTranslation('common')(ErrorBoundaryInner)
export default ErrorBoundary
