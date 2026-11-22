import { useEffect, useState } from 'react'
import { apiFetch, getApiUrl } from '../api'

export default function ApiConnectionNotice() {
  const [problem, setProblem] = useState('')

  useEffect(() => {
    const calls = new AbortController()
    async function checkConnection() {
      if (window.location.protocol === 'file:' && !window.posConfig?.apiBaseUrl) {
        setProblem('The local POS backend is unavailable. Reopen the app to restart it.')
        return
      }
      try {
        const response = await apiFetch(getApiUrl('health'), {
          signal: AbortSignal.any([calls.signal, AbortSignal.timeout(5000)]),
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        if (!response.ok || (await response.json()).status !== 'ok') throw new Error('API unavailable')
        if (!calls.signal.aborted) setProblem('')
      } catch {
        if (!calls.signal.aborted) {
          setProblem('Cannot reach the POS server. Sign-in requires a connection. Pending sales will retry when the server is reachable.')
        }
      }
    }
    checkConnection()
    window.addEventListener('online', checkConnection)
    window.addEventListener('offline', checkConnection)
    const interval = window.setInterval(checkConnection, 15000)
    return () => {
      calls.abort()
      window.removeEventListener('online', checkConnection)
      window.removeEventListener('offline', checkConnection)
      window.clearInterval(interval)
    }
  }, [])

  if (!problem) return null
  return <div className="pos-connection-notice" role="status">{problem}</div>
}
