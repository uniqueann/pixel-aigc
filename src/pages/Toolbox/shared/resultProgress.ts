export type FooterMode = 'cancel' | 'download' | 'retry' | 'empty' | 'process'

/** 底部主行动只保留一个：处理中取消、全部完成下载、有失败先重试。 */
export function footerMode({ processing, itemCount, allDone, failedCount }: {
  processing: boolean
  itemCount: number
  allDone: boolean
  failedCount: number
}): FooterMode {
  if (processing) return 'cancel'
  if (allDone) return 'download'
  if (failedCount > 0) return 'retry'
  if (itemCount === 0) return 'empty'
  return 'process'
}

export function progressLabel({ itemCount, completedCount, failedCount, processing }: {
  itemCount: number
  completedCount: number
  failedCount: number
  processing: boolean
}) {
  if (itemCount === 0) return '尚未添加图片'
  // 处理中也要及时暴露失败数，避免失败项被“处理中”掩盖到批次结束。
  if (processing) {
    return failedCount > 0
      ? `${completedCount} / ${itemCount} 张已完成，${failedCount} 张失败`
      : `${completedCount} / ${itemCount} 张已完成`
  }
  if (failedCount > 0) return `${completedCount} / ${itemCount} 张已完成，${failedCount} 张失败`
  if (completedCount === itemCount) return `全部 ${itemCount} 张已完成，可打包下载`
  return `${completedCount} / ${itemCount} 张已完成`
}
