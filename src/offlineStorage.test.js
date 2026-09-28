import test from 'node:test'
import assert from 'node:assert/strict'

const memoryStorage = new Map()

const mockStorage = {
  getItem(key) {
    return memoryStorage.has(key) ? memoryStorage.get(key) : null
  },
  setItem(key, value) {
    memoryStorage.set(key, String(value))
  },
  removeItem(key) {
    memoryStorage.delete(key)
  },
  clear() {
    memoryStorage.clear()
  },
}

globalThis.window = { localStorage: mockStorage }

const {
  enqueueSyncAction,
  getPendingSyncQueue,
  removePendingSyncAction,
  clearPendingSyncQueue,
} = await import('./offlineStorage.js')

test('pending sync queue stores and removes offline actions', () => {
  clearPendingSyncQueue()

  const queued = enqueueSyncAction({
    type: 'sale',
    endpoint: '/api/sales',
    method: 'POST',
    payload: { total: 42.5 },
  })

  assert.ok(queued.id)
  assert.equal(getPendingSyncQueue().length, 1)
  assert.equal(getPendingSyncQueue()[0].type, 'sale')

  removePendingSyncAction(queued.id)
  assert.equal(getPendingSyncQueue().length, 0)
})
