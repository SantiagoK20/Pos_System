import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

test('verification email uses the ID token from custom-token sign-in', async (t) => {
  const idToken = 'fixture.' + Buffer.from(JSON.stringify({ sub: 'fixture-admin', firebase: { sign_in_provider: 'custom' } })).toString('base64url') + '.fixture'
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const action = new URL(url).pathname.split('/').at(-1)
    requests.push([action, JSON.parse(options.body)])
    const responses = {
      'accounts:signInWithCustomToken': { idToken, refreshToken: 'fixture-refresh', expiresIn: '3600' },
      'accounts:lookup': { users: [{ localId: 'fixture-admin', email: 'admin@example.test' }] },
      'accounts:sendOobCode': { email: 'admin@example.test' },
    }
    assert.ok(responses[action])
    return Response.json(responses[action])
  })
  const { initializeApp } = await import('firebase/app')
  const { initializeAuth, inMemoryPersistence, signInWithCustomToken, sendEmailVerification } = await import('firebase/auth')
  const auth = initializeAuth(initializeApp({ apiKey: 'fixture-key' }), { persistence: inMemoryPersistence })
  const { user } = await signInWithCustomToken(auth, 'fixture-custom-token')
  await sendEmailVerification(user)
  await sendEmailVerification(user)

  const verificationRequests = requests.filter(([action]) => action === 'accounts:sendOobCode')
  const expected = ['accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken }]
  assert.deepEqual(verificationRequests, [expected, expected])
})
