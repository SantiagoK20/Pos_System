const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('posPrinter', {
  printCurrent: () => ipcRenderer.invoke('printer:print-current'),
  printHtml: (html) => ipcRenderer.invoke('printer:print-html', { html }),
})
