import { useEffect, useRef, useState } from 'react'
import { WORKSTATION_CANVAS_WIDTH, workstationCanvasDisplaySize, type CanvasDisplaySize } from './canvasDisplay'

export function useCanvasDisplay() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [display, setDisplay] = useState<CanvasDisplaySize>(() => workstationCanvasDisplaySize(WORKSTATION_CANVAS_WIDTH))

  useEffect(() => {
    const element = hostRef.current
    if (!element) return
    const update = () => setDisplay(workstationCanvasDisplaySize(element.clientWidth))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { hostRef, display }
}
