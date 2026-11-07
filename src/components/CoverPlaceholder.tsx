import type { ReactNode } from 'react'

/** 封面占位：没有可展示媒体时，图片/视频/邮件共用首页作品封面的裸图标语言。 */
export default function CoverPlaceholder({ icon }: { icon: ReactNode }) {
  return <span className="cover-placeholder" aria-hidden="true">{icon}</span>
}
