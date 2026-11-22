import assert from 'node:assert/strict'
import test from 'node:test'
import { getApiUrl } from './api.js'
import { enqueueSyncAction, getPendingSyncQueue, removePendingSyncAction } from './offlineStorage.js'
import { canSyncAction, submitQueuedAction } from './pendingSync.js'

test('desktop uses loopback and browser development uses the Vite proxy', () => {
  globalThis.window = { location: { protocol: 'http:' } }
  assert.equal(getApiUrl('menu'), '/api/menu')
  window.location.protocol = 'file:'
  assert.throws(() => getApiUrl('menu'), /local POS backend is unavailable/)
  window.posConfig = { apiBaseUrl: 'http://127.0.0.1:43210' }
  assert.equal(getApiUrl('menu'), 'http://127.0.0.1:43210/api/menu')
})

test('a queued sale survives a failed or mismatched response and retries on loopback', async (t) => {
  const data = new Map()
  globalThis.window = {
    location: { protocol: 'file:' },
    posConfig: { apiBaseUrl: 'http://127.0.0.1:43210', instance: 'test-instance' },
    localStorage: { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) },
  }
  const action = {
    type: 'sale',
    ownerUid: 'cashier-1',
    endpoint: 'http://127.0.0.1:8001/api/sales',
    payload: { clientSaleId: '6d8cb8aa-7e50-4a16-8e10-98bc04727118' },
  }
  const queued = enqueueSyncAction(action)
  assert.equal(enqueueSyncAction(action).id, queued.id)
  assert.equal(canSyncAction(queued, 'cashier-2'), false)
  assert.equal(canSyncAction(queued, 'cashier-1'), true)

  let attempt = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:43210/api/sales')
    assert.equal(options.headers.get('Authorization'), 'Bearer fixture')
    assert.equal(options.headers.get('X-POS-Instance'), 'test-instance')
    assert.equal(options.redirect, 'error')
    assert.deepEqual(JSON.parse(options.body), action.payload)
    attempt += 1
    if (attempt === 1) throw new TypeError('Offline')
    return Response.json({ success: true, data: { id: attempt === 2 ? 'wrong-id' : action.payload.clientSaleId } })
  })
  await assert.rejects(submitQueuedAction(queued, 'Bearer fixture'), /Offline/)
  await assert.rejects(submitQueuedAction(queued, 'Bearer fixture'), /Sync failed/)
  assert.equal(getPendingSyncQueue().length, 1)
  await submitQueuedAction(queued, 'Bearer fixture')
  removePendingSyncAction(queued.id)
  assert.equal(getPendingSyncQueue().length, 0)
})
