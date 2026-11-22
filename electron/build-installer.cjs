const fs = require('node:fs')
const path = require('node:path')
const { parseEnv } = require('node:util')
const { archFromString, build, Platform } = require('electron-builder')

async function buildPrivateInstaller() {
  const root = path.join(__dirname, '..')
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Build this installer with x64 Node.js on Windows to match the bundled PHP runtime.')
  }
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
    throw new Error('Build the React assets before packaging the installer.')
  }
  const backend = path.join(root, 'laravel-backend')
  const values = parseEnv(fs.readFileSync(path.join(backend, '.env'), 'utf8'))
  const credentialFile = values.FIREBASE_CREDENTIALS
    ? path.resolve(backend, values.FIREBASE_CREDENTIALS)
    : path.join(backend, 'storage', 'firebase-credentials.json')
  const account = JSON.parse(fs.readFileSync(credentialFile, 'utf8').replace(/^\uFEFF/, ''))
  const required = ['APP_KEY', 'FIREBASE_PROJECT', 'FIREBASE_DATABASE_URL', 'FIREBASE_WEB_API_KEY',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'AUDIT_LOG_HMAC_KEY']
  for (const key of required) {
    if (!values[key]) throw new Error(`Missing required private deployment setting: ${key}`)
  }
  if (!values.ADMIN_UIDS && !values.ADMIN_EMAIL) throw new Error('Missing POS administrator configuration.')
  if (account.type !== 'service_account' || !account.private_key || !account.client_email ||
      account.project_id !== values.FIREBASE_PROJECT) {
    throw new Error('Firebase Admin credential is missing or does not match FIREBASE_PROJECT.')
  }
  for (const key of ['FIREBASE_DATABASE_URL', 'SUPABASE_URL']) {
    const url = new URL(values[key])
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error(`${key} must be a credential-free HTTPS project origin.`)
    }
  }
  const settings = {
    ...Object.fromEntries([...required, 'ADMIN_EMAIL', 'ADMIN_UIDS', 'ADMIN_MFA_UID']
      .filter((key) => values[key]).map((key) => [key, values[key]])),
    APP_NAME: 'Atecles Grill POS',
    APP_ENV: 'production',
    APP_DEBUG: 'false',
    APP_URL: 'http://127.0.0.1',
    CACHE_STORE: 'file',
    SESSION_DRIVER: 'file',
    QUEUE_CONNECTION: 'sync',
    LOG_CHANNEL: 'single',
    LOG_LEVEL: 'warning',
  }
  if (values.ADMIN_MFA_UID) {
    throw new Error('The administrator TOTP pilot needs one shared cache. Disable it in the private release configuration before building.')
  }
  const environment = Object.entries(settings).map(([key, value]) => {
    if (/[\r\n']/.test(value)) throw new Error(`Unsupported value format in ${key}.`)
    return `${key}='${value}'`
  }).join('\n')
  const stagingRoot = path.join(root, 'release-private-staging.local')
  fs.mkdirSync(stagingRoot, { recursive: true })
  const staging = fs.mkdtempSync(path.join(stagingRoot, 'build-'))
  const envFile = path.join(staging, '.env')
  const firebaseFile = path.join(staging, 'firebase-credentials.json')
  const redistributables = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']
  try {
    fs.writeFileSync(envFile, environment + '\n')
    fs.writeFileSync(firebaseFile, JSON.stringify(account))
    for (const dll of redistributables) {
      fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', dll), path.join(staging, dll))
    }
    const electronDist = path.dirname(require('electron'))
    await build({
      targets: Platform.WINDOWS.createTarget('nsis', archFromString('x64')),
      config: {
        electronDist,
        extraResources: [
          { from: 'php', to: 'php', filter: ['*.dll', 'php.exe', 'php.ini', 'cacert.pem', 'license.txt', 'ext/*.dll',
            ...redistributables.map((file) => `!${file}`)] },
          { from: staging, to: 'php', filter: redistributables },
          { from: 'laravel-backend', to: 'laravel-backend', filter: [
            'app/**/*', 'bootstrap/app.php', 'bootstrap/providers.php', 'config/*.php', 'composer.json', 'public/index.php', 'resources/views/**/*',
            'routes/*.php', 'vendor/**/*',
          ] },
          { from: staging, to: 'private-config', filter: ['.env', 'firebase-credentials.json'] },
        ],
        afterPack: ({ appOutDir }) => {
          for (const file of ['private-config/.env', 'private-config/firebase-credentials.json',
            'php/php.exe', 'laravel-backend/public/index.php', ...redistributables.map((dll) => `php/${dll}`)]) {
            if (!fs.existsSync(path.join(appOutDir, 'resources', file))) {
              throw new Error(`Private deployment resource was not packaged: ${file}`)
            }
          }
        },
      },
    })
  } finally {
    for (const file of [envFile, firebaseFile, ...redistributables.map((dll) => path.join(staging, dll))]) {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
    fs.rmdirSync(staging)
  }
}

buildPrivateInstaller().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
