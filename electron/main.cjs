const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs')

const FILE_FILTERS = [
  { name: 'Проект кабельного менеджера', extensions: ['cbm'] },
  { name: 'JSON', extensions: ['json'] },
]

let win = null
let forceClose = false
let isDirty = false // состояние «нет сохранённых изменений» держит renderer

function createWindow () {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    icon: path.join(__dirname, '../icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  win.loadFile(path.join(__dirname, '../dist/index.html'))

  // Закрытие окна: чистое состояние — закрываем сразу;
  // есть несохранённые изменения — спрашиваем у renderer
  win.on('close', (e) => {
    if (forceClose || !isDirty) return
    e.preventDefault()
    if (win) win.webContents.send('cm:menu', 'close-request')
  })
}

// --- файловые операции ---
ipcMain.handle('cm:save', async (_e, { json, filePath }) => {
  if (filePath) {
    fs.writeFileSync(filePath, json, 'utf8')
    return { ok: true, filePath }
  }
  const r = await dialog.showSaveDialog({
    title: 'Сохранить проект как',
    defaultPath: 'project.cbm',
    filters: FILE_FILTERS,
  })
  if (r.canceled || !r.filePath) return { ok: false }
  fs.writeFileSync(r.filePath, json, 'utf8')
  return { ok: true, filePath: r.filePath }
})

ipcMain.handle('cm:open', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Открыть проект',
    filters: FILE_FILTERS,
    properties: ['openFile'],
  })
  if (r.canceled || !r.filePaths[0]) return null
  const filePath = r.filePaths[0]
  const json = fs.readFileSync(filePath, 'utf8')
  return { filePath, json }
})

// --- экспорт файлов (CSV/SVG/DXF-текст, PNG-base64) ---
ipcMain.handle('cm:save-export', async (_e, { defaultName, text, base64, extName, ext }) => {
  const r = await dialog.showSaveDialog({
    title: 'Экспорт',
    defaultPath: defaultName,
    filters: [{ name: extName, extensions: [ext] }],
  })
  if (r.canceled || !r.filePath) return { ok: false }
  if (typeof text === 'string') fs.writeFileSync(r.filePath, text, 'utf8')
  else fs.writeFileSync(r.filePath, Buffer.from(base64, 'base64'))
  return { ok: true, filePath: r.filePath }
})

ipcMain.on('cm:dirty', (_e, d) => {
  isDirty = !!d
})

ipcMain.on('cm:close-confirm', () => {
  forceClose = true
  if (win) win.close()
})

// --- меню приложения ---
const menu = Menu.buildFromTemplate([
  {
    label: 'Файл',
    submenu: [
      { label: 'Новый проект', accelerator: 'CmdOrCtrl+N', click: (_i, w) => w && w.webContents.send('cm:menu', 'new') },
      { label: 'Открыть…', accelerator: 'CmdOrCtrl+O', click: (_i, w) => w && w.webContents.send('cm:menu', 'open') },
      { type: 'separator' },
      { label: 'Сохранить', accelerator: 'CmdOrCtrl+S', click: (_i, w) => w && w.webContents.send('cm:menu', 'save') },
      { label: 'Сохранить как…', accelerator: 'CmdOrCtrl+Shift+S', click: (_i, w) => w && w.webContents.send('cm:menu', 'saveAs') },
      { type: 'separator' },
      { role: 'quit', label: 'Выход' },
    ],
  },
  {
    label: 'Правка',
    submenu: [
      { label: 'Отменить', accelerator: 'CmdOrCtrl+Z', click: (_i, w) => w && w.webContents.send('cm:menu', 'undo') },
      { label: 'Повторить', accelerator: 'CmdOrCtrl+Shift+Z', click: (_i, w) => w && w.webContents.send('cm:menu', 'redo') },
      { type: 'separator' },
      { role: 'cut', label: 'Вырезать' },
      { role: 'copy', label: 'Копировать' },
      { role: 'paste', label: 'Вставить' },
    ],
  },
  {
    label: 'Вид',
    submenu: [
      { role: 'reload', label: 'Обновить' },
      { role: 'toggleDevTools', label: 'Инструменты разработчика' },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Масштаб 100%' },
      { role: 'zoomIn', label: 'Увеличить' },
      { role: 'zoomOut', label: 'Уменьшить' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Полный экран' },
    ],
  },
])

app.whenReady().then(() => {
  Menu.setApplicationMenu(menu)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
