import { apiFetch, getApiUrl } from './api.js'

const routes = new Map([
  ['sale', ['sales', 'POST']],
  ['menu-add', ['menu', 'POST']],
  ['menu-edit', ['menu', 'PUT']],
  ['menu-delete', ['menu', 'DELETE']],
])

export function canSyncAction(action, sessionUid) {
  return routes.has(action.type) && (!action.ownerUid || action.ownerUid === sessionUid)
}

export function applyPendingMenuChanges(items, queue) {
  const byId = new Map(items.map((item) => [String(item.id), item]))
  for (const { type, payload, id, createdAt } of queue) {
    if (!payload || !routes.has(type) || type === 'sale') continue
    const itemId = String(payload.id ?? payload.clientMenuId ?? id)
    if (type === 'menu-delete') {
      byId.delete(itemId)
    } else {
      const { expected, clientMenuId, ...item } = payload
      byId.set(itemId, {
        ...item,
        id: itemId,
        queuedAt: createdAt,
        syncStatus: 'pending',
      })
    }
  }
  return [...byId.values()]
}

export async function submitQueuedAction(action, authorization) {
  const [path, method] = routes.get(action.type)
  const response = await apiFetch(getApiUrl(path), {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(action.payload),
  })
  const result = await response.json()
  const saleId = action.payload?.clientSaleId ?? action.payload?.id
  if (!response.ok || result.success !== true ||
      (action.type === 'sale' && (saleId == null || String(result.data?.id) !== String(saleId)))) {
    const error = new Error(result.message || `Sync failed (HTTP ${response.status})`)
    error.status = response.status
    throw error
  }
  return result
}
