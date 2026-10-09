import { getVercelOidcToken } from '@vercel/oidc'

export async function readVercelOidcToken() {
  const token = await getVercelOidcToken()
  return typeof token === 'string' ? token : ''
}
export async function gatewayToken() {
  return process.env.AI_GATEWAY_API_KEY?.trim() || await readVercelOidcToken()
}
