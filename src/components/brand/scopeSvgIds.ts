/** 同一页内联多份 SVG 时，给 gradient / clipPath id 加作用域，避免 url(#id) 串用。 */
export function scopeSvgIds(svg: string, scope: string): string {
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
    .sort((left, right) => right.length - left.length)
  let next = svg
  for (const id of ids) {
    const scoped = `${scope}-${id}`
    next = next.replaceAll(`id="${id}"`, `id="${scoped}"`)
    next = next.replaceAll(`url(#${id})`, `url(#${scoped})`)
    next = next.replaceAll(`href="#${id}"`, `href="#${scoped}"`)
  }
  return next
}
