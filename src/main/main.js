const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const archiver = require('archiver');
const audiowmark = require('./audiowmark');
const db = require('./db');

const AUDIO_EXTS = ['wav', 'flac', 'mp3', 'ogg'];

function listAudioInDir(dirPath) {
  try {
    return fs
      .readdirSync(dirPath)
      .map((name) => path.join(dirPath, name))
      .filter((p) => {
        try { return fs.statSync(p).isFile(); } catch { return false; }
      })
      .filter((p) => AUDIO_EXTS.includes(path.extname(p).slice(1).toLowerCase()))
      .sort();
  } catch {
    return [];
  }
}

function zipDirectory(sourceDir, outZipPath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outZipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    out.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(out);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

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

ipcMain.handle('dialog:pickInputFiles', async () => {
  if (!mainWindow) return [];
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose source audio files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio', extensions: AUDIO_EXTS },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('dialog:pickInputFolder', async () => {
  if (!mainWindow) return [];
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose folder of audio',
    properties: ['openDirectory'],
  });
  if (res.canceled) return [];
  return listAudioInDir(res.filePaths[0]);
});

ipcMain.handle('dialog:pickOutputDir', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('watermark:generate', async (event, { inputPaths, outputDir, recipients, zip }) => {
  const keyPath = await audiowmark.ensureMasterKey();
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

    const id = crypto.randomBytes(16).toString('hex');
    const recipientDir = path.join(outputDir, slug);

    event.sender.send('watermark:progress', {
      index: i,
      status: 'running',
      tracksTotal: inputPaths.length,
      tracksDone: 0,
    });

    try {
      fs.mkdirSync(recipientDir, { recursive: true });
      const recordsForRecipient = [];

      for (let t = 0; t < inputPaths.length; t++) {
        const inputPath = inputPaths[t];
        const ext = path.extname(inputPath);
        const inputBase = path.basename(inputPath, ext);
        const outputName = `${inputBase}_${slug}${ext}`;
        const outputPath = path.join(recipientDir, outputName);

        event.sender.send('watermark:progress', {
          index: i,
          status: 'running',
          tracksTotal: inputPaths.length,
          tracksDone: t,
          currentTrack: path.basename(inputPath),
        });

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
        recordsForRecipient.push(record);
      }

      let zipPath = null;
      if (zip) {
        event.sender.send('watermark:progress', {
          index: i,
          status: 'zipping',
          tracksTotal: inputPaths.length,
          tracksDone: inputPaths.length,
        });
        zipPath = path.join(outputDir, `${slug}.zip`);
        await zipDirectory(recipientDir, zipPath);
        rmrf(recipientDir);
      }

      event.sender.send('watermark:progress', {
        index: i,
        status: 'done',
        tracksTotal: inputPaths.length,
        tracksDone: inputPaths.length,
        id,
        zipPath,
        recipientDir: zip ? null : recipientDir,
      });
      results.push({ ok: true, recipient, id, records: recordsForRecipient, zipPath });
    } catch (err) {
      event.sender.send('watermark:progress', {
        index: i,
        status: 'error',
        error: err.message,
      });
      results.push({ ok: false, recipient, error: err.message });
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
  const allRecords = db.findAllById(messageId);
  if (allRecords.length === 0) {
    return { found: true, messageId, record: null, allRecords: [], matchedByFilename: false };
  }
  const scannedBase = path.basename(filePath).toLowerCase();
  const exact = allRecords.find((r) => (r.outputName || '').toLowerCase() === scannedBase);
  return {
    found: true,
    messageId,
    record: exact || allRecords[0],
    allRecords,
    matchedByFilename: !!exact,
  };
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
