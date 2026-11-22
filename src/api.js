const configuredApiBaseUrl = (import.meta.env?.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/api$/i, '')

export function getApiUrl(path) {
  const apiPath = String(path).replace(/^\/+/, '')

  if (window.location.protocol === 'file:') {
    const baseUrl = window.posConfig?.apiBaseUrl
    if (!baseUrl) throw new Error('The local POS backend is unavailable.')
    return `${baseUrl}/api/${apiPath}`
  }

  return `${configuredApiBaseUrl}/api/${apiPath}`
}

export function apiFetch(url, options = {}) {
  const timeout = AbortSignal.timeout(30000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const headers = new Headers(options.headers)
  if (window.location.protocol === 'file:' && window.posConfig?.instance &&
      new URL(url).origin === window.posConfig.apiBaseUrl) {
    headers.set('X-POS-Instance', window.posConfig.instance)
  }
  return fetch(url, { ...options, headers, cache: 'no-store', redirect: 'error', signal })
}
