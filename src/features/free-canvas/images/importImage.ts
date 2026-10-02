import { InsertGeneratedAssetCommand } from '@/editor/commands'
import { useEditorStore } from '@/editor/store'
import { createImageAsset } from '@/editor/services/assetService'
import type { ImageAsset } from '@/editor/types'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { isCurrentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import type { WorkstationHistoryListItem } from '@/features/assets/workstationHistory'
import { readOwnedImage } from '@/services/api/ownedImages'
import { uploadImage } from '@/services/api/upload'
import { readResultImage } from '@/features/image-workstation/imageMetadata'
import { assetPlaceholder } from '@/cloud/assets'
import { calculateInitialImageNode, calculateNodeBounds, offsetPlacementToAvoidOverlap, type CanvasPoint } from '../geometry'

export interface CanvasImageImportContext {
  ownerId: string; projectId: string; sceneId: string; epoch: number; center: CanvasPoint; signal: AbortSignal
}

function check(context: CanvasImageImportContext) {
  if (context.signal.aborted) throw new DOMException('图片添加已取消', 'AbortError')
  if (!isCurrentWorkstationHistoryOwner(context.ownerId) || useEditorStore.getState().project?.id !== context.projectId || usePersistenceStore.getState().epoch !== context.epoch)
    throw new Error('账号或项目已切换，请重新添加图片')
  if (!usePersistenceStore.getState().writable) throw new Error('当前页面没有画布编辑权')
}

function insert(asset: ImageAsset, context: CanvasImageImportContext) {
  check(context)
  const editor = useEditorStore.getState()
  const scene = editor.project?.document.scenes.find(item => item.id === context.sceneId)
  if (!scene) throw new Error('当前画布不存在')
  const existing = asset.objectKey ? Object.values(editor.project!.assets).find(item => item.type === 'image' && item.objectKey === asset.objectKey) as ImageAsset | undefined : undefined
  asset = existing ?? asset
  const node = calculateInitialImageNode(asset, scene)
  const placed = offsetPlacementToAvoidOverlap(
    { x: context.center.x - node.width / 2, y: context.center.y - node.height / 2, width: node.width, height: node.height },
    scene.nodes.map(item => calculateNodeBounds(item)),
  )
  node.x = placed.x
  node.y = placed.y
  node.zIndex = Math.max(-1, ...scene.nodes.map(item => item.zIndex)) + 1
  editor.executeCommand(new InsertGeneratedAssetCommand(scene.id, asset, node))
  editor.selectNodes([node.id])
  return node
}

export async function importCanvasFile(file: File, context: CanvasImageImportContext) {
  check(context)
  const uploaded = await uploadImage(file, { local: true })
  return insert(createImageAsset(uploaded), context)
}

export async function importCanvasHistory(record: WorkstationHistoryListItem, context: CanvasImageImportContext) {
  check(context)
  const blob = await readOwnedImage({ historyId: record.id, objectKey: record.objectKey }, { ownerId: context.ownerId, signal: context.signal })
  const measured = await readResultImage(blob)
  const id = crypto.randomUUID()
  const url = record.objectKey ? assetPlaceholder(id) : await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取资产图片失败'))
    reader.readAsDataURL(measured.blob)
  })
  return insert(createImageAsset({ id, name: '资产图片', url, objectKey: record.objectKey, ...measured, createdAt: record.createdAt }), context)
}
