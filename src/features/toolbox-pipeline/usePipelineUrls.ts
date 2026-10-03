import { useMemo } from 'react'
import { useBlobUrls } from '@/components/useBlobUrls'
import type { PipelineItem } from './types'

/** 图片引用保存在会话中，展示 URL 仅由当前页面持有。 */
export function usePipelineUrls(items: PipelineItem[]) {
  const blobs = useMemo(() => items.flatMap(item => [item.file, item.intermediate?.blob, item.output?.blob]), [items])
  return useBlobUrls(blobs)
}
