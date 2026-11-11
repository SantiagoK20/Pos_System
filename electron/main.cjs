
const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')
const { spawn } = require('child_process')

const PORT = 8001
const HOST = '127.0.0.1'

let mainWindow = null
let phpProcess = null
let stopping = false

function assertMainFrame(event) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('Printing is only available from the POS window.')
  }
}

function printWebContents(webContents) {
  return new Promise((resolve, reject) => {
    webContents.print(
      { silent: true, printBackground: true },
      (success, failureReason) => {
        if (success) {
          resolve()
        } else {
          reject(new Error(failureReason || 'The printer could not print the receipt.'))
        }
      }
    )
  })
}

ipcMain.handle('printer:print-current', async (event) => {
  assertMainFrame(event)
  await printWebContents(event.sender)
})

ipcMain.handle('printer:print-html', async (event, { html }) => {
  assertMainFrame(event)
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('There is no receipt content to print.')
  }

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await printWebContents(printWindow.webContents)
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close()
    }
  }
})

function getAppPaths() {
  const root = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..')

  return {
    php: path.join(root, 'php', 'php.exe'),
    phpExt: path.join(root, 'php', 'ext'),
    caCert: path.join(root, 'php', 'cacert.pem'),
    backend: path.join(root, 'laravel-backend'),
    frontend: app.isPackaged
      ? path.join(app.getAppPath(), 'dist', 'index.html')
      : path.join(root, 'dist', 'index.html'),
    opcacheCache: path.join(app.getPath('userData'), 'opcache-cache'),
  }
}

function checkServer() {
  return new Promise((resolve) => {
    const request = http.get(`http://${HOST}:${PORT}/up`, (response) => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 500)
    })

    request.setTimeout(1000, () => {
      request.destroy()
      resolve(false)
    })

    request.on('error', () => resolve(false))
  })
}

async function waitForServer(timeoutMs = 45000) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    if (stopping) return false

    if (await checkServer()) return true

    if (phpProcess && phpProcess.exitCode !== null) {
      throw new Error(
        `PHP exited before Laravel became ready (code ${phpProcess.exitCode}).`
      )
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  return false
}

async function startLaravel(paths) {
  if (await checkServer()) {
    console.log('Laravel is already running on port ' + PORT)
    return
  }

  if (!fs.existsSync(paths.php)) {
    throw new Error(`PHP executable not found:\n${paths.php}`)
  }

  if (!fs.existsSync(paths.phpExt)) {
    throw new Error(`PHP extension directory not found:\n${paths.phpExt}`)
  }

  if (!fs.existsSync(path.join(paths.phpExt, 'php_openssl.dll'))) {
    throw new Error(`PHP OpenSSL extension not found:\n${path.join(paths.phpExt, 'php_openssl.dll')}`)
  }

  if (!fs.existsSync(paths.caCert)) {
    throw new Error(`CA certificate not found:\n${paths.caCert}`)
  }

  if (!fs.existsSync(path.join(paths.backend, 'public', 'index.php'))) {
    throw new Error(`Laravel backend not found:\n${paths.backend}`)
  }

  fs.mkdirSync(paths.opcacheCache, { recursive: true })

  phpProcess = spawn(
    paths.php,
    [
      '-d',
      `extension_dir=${paths.phpExt}`,
      '-d',
      `opcache.file_cache=${paths.opcacheCache}`,
      '-d',
      'opcache.file_cache_fallback=1',
      '-d',
      `curl.cainfo=${paths.caCert}`,
      '-d',
      `openssl.cafile=${paths.caCert}`,
      '-S',
      `${HOST}:${PORT}`,
      '-t',
      path.join(paths.backend, 'public'),
      path.join(paths.backend, 'public', 'index.php'),
    ],
    {
      cwd: paths.backend,
      windowsHide: true,
      env: {
        ...process.env,
        APP_ENV: 'production',
        APP_DEBUG: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  phpProcess.stdout.on('data', (data) => {
    console.log(`[PHP] ${data.toString().trim()}`)
  })

  phpProcess.stderr.on('data', (data) => {
    console.error(`[PHP] ${data.toString().trim()}`)
  })

  phpProcess.on('error', (error) => {
    console.error('PHP startup error:', error)
  })

  const ready = await waitForServer()

  if (!ready) {
    throw new Error('Laravel did not respond within 45 seconds.')
  }
}

async function createWindow() {
  const paths = getAppPaths()

  try {
    await startLaravel(paths)

    if (stopping) return

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.cjs'),
      },
    })

    mainWindow.once('ready-to-show', () => mainWindow.show())

    await mainWindow.loadFile(paths.frontend)
  } catch (error) {
    if (!stopping) {
      dialog.showErrorBox(
        'Atecles Grill POS - Startup Error',
        error.message
      )
      app.quit()
    }
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  stopping = true

  if (phpProcess && phpProcess.exitCode === null) {
    phpProcess.kill()
  }
})
