export function scrollEdges(el: { scrollLeft: number; scrollWidth: number; clientWidth: number }) {
  const max = el.scrollWidth - el.clientWidth
  return {
    left: el.scrollLeft > 1,
    right: max - el.scrollLeft > 1,
  }
}

/** 把选中标签滚进可视区，并躲开两侧渐隐遮罩。 */
export function scrollSelectedIntoView(container: HTMLElement, selected: HTMLElement, inset = 28) {
  const left = selected.offsetLeft - inset
  const right = selected.offsetLeft + selected.offsetWidth + inset
  const viewLeft = container.scrollLeft
  const viewRight = viewLeft + container.clientWidth
  if (left < viewLeft) container.scrollLeft = Math.max(0, left)
  else if (right > viewRight) container.scrollLeft = Math.max(0, right - container.clientWidth)
}
