const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function isReady(url, token) {
  return new Promise((resolve) => {
    const request = http.get(`${url}/api/health`, {
      headers: { 'X-POS-Instance': token },
    }, (response) => {
      response.resume()
      resolve(response.statusCode === 200 && response.headers['x-pos-ready'] === token)
    })
    request.on('error', () => resolve(false))
    request.setTimeout(2000, () => request.destroy())
  })
}

function createLocalBackend(root, userData, packaged) {
  let child
  let stopped = false

  return {
    async start() {
      const php = path.join(root, 'php')
      const backend = path.join(root, 'laravel-backend')
      const storage = path.join(userData, 'laravel-storage')
      const bootstrapCache = path.join(storage, 'bootstrap-cache')
      const publicDir = path.join(backend, 'public')
      const config = path.join(root, 'private-config')
      const executable = path.join(php, 'php.exe')
      for (const file of [executable, path.join(php, 'cacert.pem'), path.join(publicDir, 'index.php'),
        ...(packaged ? [path.join(config, '.env'), path.join(config, 'firebase-credentials.json')] : [])]) {
        if (!fs.existsSync(file)) throw new Error(`Installation file is missing: ${path.basename(file)}. Reinstall the POS.`)
      }
      for (const directory of [bootstrapCache, ...['framework/cache/data', 'framework/sessions', 'framework/views', 'logs', 'app']
        .map((name) => path.join(storage, name))]) {
        fs.mkdirSync(directory, { recursive: true })
      }

      const port = await allocatePort()
      if (stopped) throw new Error('POS startup stopped.')
      const url = `http://127.0.0.1:${port}`
      const token = randomBytes(32).toString('hex')
      const env = {
        ...process.env,
        POS_DESKTOP_TOKEN: token,
        APP_DEBUG: 'false',
        ...(packaged ? {
          APP_ENV: 'production',
          POS_ENV_PATH: config,
          FIREBASE_CREDENTIALS: path.join(config, 'firebase-credentials.json'),
          LARAVEL_STORAGE_PATH: storage,
          APP_CONFIG_CACHE: path.join(bootstrapCache, 'config.php'),
          APP_PACKAGES_CACHE: path.join(bootstrapCache, 'packages.php'),
          APP_SERVICES_CACHE: path.join(bootstrapCache, 'services.php'),
        } : {}),
      }
      child = spawn(executable, [
        '-c', path.join(php, 'php.ini'),
        '-d', `extension_dir=${path.join(php, 'ext')}`,
        '-d', `curl.cainfo=${path.join(php, 'cacert.pem')}`,
        '-d', `openssl.cafile=${path.join(php, 'cacert.pem')}`,
        '-d', 'expose_php=0',
        '-S', `127.0.0.1:${port}`, '-t', publicDir, path.join(publicDir, 'index.php'),
      ], { cwd: backend, env, windowsHide: true, stdio: 'ignore' })

      let spawnError
      child.on('error', (error) => { spawnError = error })
      const deadline = Date.now() + 60000
      while (!stopped && Date.now() < deadline) {
        if (spawnError) throw spawnError
        if (child.exitCode !== null) throw new Error(`The local PHP runtime stopped (exit ${child.exitCode}).`)
        if (await isReady(url, token)) return { url, token }
        await delay(300)
      }
      throw new Error('The local POS backend did not start.')
    },
    stop() {
      stopped = true
      if (child?.exitCode === null) child.kill()
    },
  }
}

module.exports = { createLocalBackend }
