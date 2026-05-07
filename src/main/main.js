const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const audiowmark = require('./audiowmark');
const db = require('./db');

const AUDIO_EXTS = ['wav', 'flac', 'mp3', 'ogg'];

function slugify(str) {
  const s = str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
  return s || 'recipient';
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0c0c0e',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    frame: false,
    thickFrame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:state', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:state', { maximized: false }));
}

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize-toggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

ipcMain.handle('dialog:pickInput', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose source audio',
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: AUDIO_EXTS },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dialog:pickOutputDir', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('watermark:generate', async (event, { inputPath, outputDir, recipients }) => {
  const keyPath = await audiowmark.ensureMasterKey();
  const ext = path.extname(inputPath);
  const inputBase = path.basename(inputPath, ext);
  const batchId = crypto.randomUUID();
  const usedSlugs = new Set();
  const results = [];

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i].trim();
    let baseSlug = slugify(recipient);
    let slug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix++}`;
    }
    usedSlugs.add(slug);

    const outputName = `${inputBase}_${slug}${ext}`;
    const outputPath = path.join(outputDir, outputName);
    const id = crypto.randomBytes(16).toString('hex');

    event.sender.send('watermark:progress', { index: i, status: 'running' });

    try {
      await audiowmark.add(inputPath, outputPath, id, keyPath);
      const record = {
        id,
        recipient,
        sourceTrack: inputPath,
        sourceTrackName: path.basename(inputPath),
        outputPath,
        outputName,
        batchId,
        createdAt: Date.now(),
      };
      db.addCopy(record);
      event.sender.send('watermark:progress', {
        index: i,
        status: 'done',
        outputName,
        outputPath,
        id,
      });
      results.push({ ok: true, ...record });
    } catch (err) {
      event.sender.send('watermark:progress', {
        index: i,
        status: 'error',
        error: err.message,
      });
      results.push({ ok: false, error: err.message });
    }
  }

  return { batchId, results };
});

ipcMain.handle('dialog:pickScanFile', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose track to scan',
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: AUDIO_EXTS },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('scan:run', async (_e, filePath) => {
  const keyPath = await audiowmark.ensureMasterKey();
  const messageId = await audiowmark.extractMessage(filePath, keyPath);
  if (!messageId) return { found: false };
  const record = db.findById(messageId);
  return { found: true, messageId, record: record || null };
});

ipcMain.handle('history:list', async () => {
  return db.listAll();
});

ipcMain.handle('shell:revealInFolder', async (_e, p) => {
  if (!p) return;
  require('electron').shell.showItemInFolder(p);
});

ipcMain.handle('system:status', async () => {
  const keyPath = audiowmark.masterKeyPath();
  const keyStat = fs.existsSync(keyPath) ? fs.statSync(keyPath) : null;
  return {
    audiowmarkPath: audiowmark.exePath(),
    masterKeyPath: keyPath,
    masterKeyExists: !!keyStat,
    masterKeyBytes: keyStat ? keyStat.size : 0,
    dbPath: db.dbPath(),
    copyCount: db.count(),
  };
});

app.whenReady().then(async () => {
  await audiowmark.ensureMasterKey();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
