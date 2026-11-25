import { authEnabled, supabase } from '@/cloud/client'
import { i18n } from '@/i18n'
import { extractErrorExtra, extractRequestId, translateApiError } from '@/i18n/apiErrors'
import { apiErrorCode, responseErrorText } from './apiErrorText'

export async function fetchOwnedObject(objectKey: string, filename?: string, signal?: AbortSignal) {
  const token = authEnabled
    ? (await supabase!.auth.getSession()).data.session?.access_token
    : localStorage.getItem('access_token')
  const params = new URLSearchParams({ key: objectKey })
  if (filename) {
    params.set('download', '1')
    params.set('filename', filename)
  }
  const response = await fetch(`/api/objects?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const fallback = response.status === 404
      ? i18n.t('errors:client.resultNotFound')
      : i18n.t('errors:client.readResultFailed')
    throw new OwnedObjectError(
      response.status,
      translateApiError({
        code: apiErrorCode(payload),
        extra: extractErrorExtra(payload),
        message: responseErrorText(payload),
        status: response.status === 413 ? undefined : response.status,
        requestId: extractRequestId(payload),
        fallback,
      }),
    )
  }
  return response.blob()
}

export class OwnedObjectError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'OwnedObjectError' }
}

export async function signedOwnedObject(objectKey: string, signal?: AbortSignal, filename?: string) {
  const token = authEnabled
    ? (await supabase!.auth.getSession()).data.session?.access_token
    : localStorage.getItem('access_token')
  const params = new URLSearchParams({ key: objectKey, mode: 'url' })
  if (filename) { params.set('disposition', 'attachment'); params.set('filename', filename) }
  const response = await fetch(`/api/objects?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    throw new OwnedObjectError(
      response.status,
      translateApiError({
        code: apiErrorCode(payload),
        extra: extractErrorExtra(payload),
        message: responseErrorText(payload),
        status: response.status === 413 ? undefined : response.status,
        requestId: extractRequestId(payload),
        fallback: i18n.t('errors:client.readImageUrlFailed'),
      }),
    )
  }
  const signed = await response.json() as { url?: string; expiresAt?: number }
  if (!signed.url) throw new Error(i18n.t('errors:client.missingImageUrl'))
  return { url: signed.url, expiresAt: signed.expiresAt }
}

export async function signedOwnedObjectUrl(objectKey: string, signal?: AbortSignal) {
  return (await signedOwnedObject(objectKey, signal)).url
}

export async function fetchOwnedObjectDirect(objectKey: string) {
  const { readOwnedImage } = await import('./ownedImages')
  return readOwnedImage({ objectKey })
}
