import { useId, useMemo } from 'react'
import { scopeSvgIds } from './scopeSvgIds'

export default function ScopedSvg({ svg, className }: { svg: string; className?: string }) {
  const scope = useId().replace(/:/g, '')
  const html = useMemo(() => scopeSvgIds(svg, scope), [svg, scope])
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
