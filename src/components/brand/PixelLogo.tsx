import iconSvg from '../../../public/brand/pixel-aigc-icon.svg?raw'
import wordmarkSvg from '../../../public/brand/pixel-aigc-logo-horizontal.svg?raw'
import ScopedSvg from './ScopedSvg'

export function PixelIcon({ className }: { className?: string }) {
  return <ScopedSvg className={className} svg={iconSvg} />
}

export function PixelWordmark({ className }: { className?: string }) {
  return <ScopedSvg className={className} svg={wordmarkSvg} />
}
