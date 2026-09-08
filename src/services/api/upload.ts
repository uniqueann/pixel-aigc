import { cloudEnabled } from '@/cloud/client'
import { apiClient } from './client'

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const useMockGateway = import.meta.env.VITE_GENERATION_MODE === 'mock'

export interface UploadedImage {
  url: string
  name: string
  mimeType: string
  width: number
  height: number
}

/** 蒙版仍沿用 Data URL；真实对象存储接入后可替换为统一上传。 */
export function uploadDataUrl(dataUrl: string): Promise<string> {
  return Promise.resolve(dataUrl)
}

/** 上传图片并返回可注册到 AssetRegistry 的元数据。 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  validateImageFile(file)
  const previewUrl = await readFileAsDataUrl(file)
  const size = await readImageSize(previewUrl)
  if (useMockGateway || cloudEnabled) {
    return { url: previewUrl, name: file.name, mimeType: file.type, ...size }
  }

  const formData = new FormData()
  formData.append('file', file)
  const uploaded = await apiClient.post<unknown, { url: string }>('/uploads', formData)
  if (!uploaded.url) throw new Error('上传接口没有返回图片地址')
  return { url: uploaded.url, name: file.name, mimeType: file.type, ...size }
}

export function validateImageFile(file: Pick<File, 'type' | 'size'>) {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) throw new Error('仅支持 PNG、JPEG 和 WebP 图片')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片大小不能超过 20 MB')
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function readImageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('无法解析图片尺寸'))
    image.src = url
  })
}
