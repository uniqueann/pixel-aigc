const appPath = /^\/(?:$|email(?:\/|$)|image-workstation(?:\/|$)|toolbox(?:\/|$)|canvas(?:\/|$)|assets(?:\/|$))/

export function safeNext(raw: string | null, origin = window.location.origin): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  try {
    const url = new URL(raw, origin)
    return url.origin === origin && appPath.test(url.pathname) ? url.pathname + url.search : '/'
  } catch { return '/' }
}
