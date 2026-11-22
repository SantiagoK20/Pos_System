import { auth } from './firebase'
import { apiFetch, getApiUrl } from './api'

let totpIdToken = null

export function setTotpSession(token) {
  totpIdToken = token
}

export function hasTotpSession() {
  return totpIdToken !== null
}

export function hasPosSession() {
  return Boolean(getPosSession())
}

export function getPosSession() {
  return totpIdToken ?? auth.currentUser
}

export async function getFirebaseAuthorizationHeader(session = getPosSession()) {
  if (!session || session !== getPosSession()) {
    throw new Error('You must sign in before performing this action.')
  }

  const token = typeof session === 'string' ? session : await session.getIdToken()
  if (session !== getPosSession()) {
    throw new Error('The POS session changed. Try again.')
  }
  return `Bearer ${token}`
}

export async function recordAuditEvent(event, details = {}) {
  const pilotLogout = event === 'logout' && hasTotpSession()
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }

  headers.Authorization = await getFirebaseAuthorizationHeader()

  const response = await apiFetch(getApiUrl('audit-events'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ event, ...details }),
  })

  if (!response.ok) {
    throw new Error(`Activity log request failed (${response.status}).`)
  }
  if (pilotLogout && (await response.json()).revoked !== true) {
    throw new Error('POS session revocation could not be confirmed.')
  }
}
