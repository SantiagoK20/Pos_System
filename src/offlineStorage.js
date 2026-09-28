const PENDING_SYNC_KEY = 'pos_pending_sync_queue'

function readStorage(key, fallback) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }

  try {
    const raw = window.localStorage.getItem(key)

    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    console.warn(`Unable to read localStorage key: ${key}`, error)
    return fallback
  }
}

function writeStorage(key, value) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn(`Unable to write localStorage key: ${key}`, error)
  }
}

export function getOfflineSnapshot(key, fallback = []) {
  return readStorage(key, fallback)
}

export function setOfflineSnapshot(key, value) {
  writeStorage(key, value)
}

export function getPendingSyncQueue() {
  return readStorage(PENDING_SYNC_KEY, [])
}

export function savePendingSyncQueue(queue) {
  writeStorage(PENDING_SYNC_KEY, queue)
}

export function enqueueSyncAction(action) {
  const queue = getPendingSyncQueue()

  const queuedAction = {
    id: action.id ?? `sync-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    ...action,
  }

  const nextQueue = [...queue, queuedAction]
  savePendingSyncQueue(nextQueue)

  return queuedAction
}

export function removePendingSyncAction(id) {
  const nextQueue = getPendingSyncQueue().filter((item) => item.id !== id)
  savePendingSyncQueue(nextQueue)
  return nextQueue
}

export function clearPendingSyncQueue() {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(PENDING_SYNC_KEY)
  }
}
