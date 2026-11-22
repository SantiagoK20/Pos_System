
const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path')
const { fileURLToPath } = require('url')
const { createLocalBackend } = require('./local-backend.cjs')
let mainWindow = null
let backend
let quitting = false

function assertMainFrame(event) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('Printing is only available from the POS window.')
  }
}

function printWebContents(webContents, options = {}) {
  return new Promise((resolve, reject) => {
    webContents.print(
      { silent: true, printBackground: true, ...options },
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
    await printWebContents(printWindow.webContents, {
      usePrinterDefaultPageSize: true,
      margins: { marginType: 'none' },
      scaleFactor: 100,
    })
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close()
    }
  }
})

async function createWindow() {
  backend = createLocalBackend(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.getPath('userData'), app.isPackaged)
  const { url, token } = await backend.start()
  if (quitting) return
  const frontend = path.join(app.getAppPath(), 'dist', 'index.html')
  const webPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    preload: path.join(__dirname, 'preload.cjs'),
    additionalArguments: [`--pos-api-base-url=${url}`, `--pos-api-instance=${token}`],
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences,
  })

  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url)
    if (target.protocol === 'file:' &&
        fileURLToPath(target) === frontend &&
        target.searchParams.get('kitchen') === '1') {
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences } }
    }
    return { action: 'deny' }
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  await mainWindow.loadFile(frontend)
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(createWindow).catch((error) => {
    if (quitting) return
    dialog.showErrorBox('Atecles Grill POS Startup Error', error.message)
    app.quit()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    quitting = true
    backend?.stop()
  })
} else {
  app.quit()
}
