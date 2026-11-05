export interface BrushCursorPlacement {
  left: number
  top: number
  size: number
  outside: boolean
}

/** 指针笔刷光标的位置与图片内外状态；坐标沿用 640×420 逻辑画布。 */
export function brushCursorPlacement(
  scene: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
  brushSize: number,
): BrushCursorPlacement {
  return {
    left: scene.x,
    top: scene.y,
    size: Math.max(1, Number.isFinite(brushSize) ? brushSize : 1),
    outside: scene.x < rect.x
      || scene.x > rect.x + rect.width
      || scene.y < rect.y
      || scene.y > rect.y + rect.height,
  }
}
