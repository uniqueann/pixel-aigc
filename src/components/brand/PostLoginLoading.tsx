import loadingSvg from '../../../public/brand/pixel-aigc-loading.svg?raw'
import ScopedSvg from './ScopedSvg'

/** 登录成功后、工作台加载或本地会话恢复期间的全屏状态。 */
export default function PostLoginLoading({ label }: { label: string }) {
  return <div className="post-login-loading" role="status">
    <ScopedSvg className="post-login-loading-mark" svg={loadingSvg} />
    <p>{label}</p>
  </div>
}
