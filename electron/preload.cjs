const { contextBridge, ipcRenderer } = require('electron')

function getArgument(prefix) {
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}
contextBridge.exposeInMainWorld('posConfig', {
  apiBaseUrl: getArgument('--pos-api-base-url='),
  instance: getArgument('--pos-api-instance='),
})

contextBridge.exposeInMainWorld('posPrinter', {
  printCurrent: () => ipcRenderer.invoke('printer:print-current'),
  printHtml: (html) => ipcRenderer.invoke('printer:print-html', { html }),
})
