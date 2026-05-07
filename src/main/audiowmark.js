const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

function binDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin');
}

function exePath() {
  return path.join(binDir(), 'audiowmark.exe');
}

function masterKeyPath() {
  return path.join(app.getPath('userData'), 'master.key');
}

async function ensureMasterKey() {
  const p = masterKeyPath();
  if (!fs.existsSync(p)) {
    await genKey(p);
  }
  return p;
}

function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(exePath(), args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`audiowmark exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function genKey(keyFilePath) {
  return run(['gen-key', keyFilePath]);
}

function ffmpegPath() {
  return path.join(binDir(), 'ffmpeg.exe');
}

function ffmpegRun(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}

function tmpPath(suffix) {
  return path.join(app.getPath('temp'), `stl-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${suffix}`);
}

function rawAdd(inputWav, outputWav, messageHex, keyFilePath) {
  const args = ['add'];
  if (keyFilePath) args.push('--key', keyFilePath);
  args.push(inputWav, outputWav, messageHex);
  return run(args);
}

// Encoder settings per output format. Keep tags + audio quality high.
function encodeArgs(outputExt, originalInputPath) {
  const ext = outputExt.toLowerCase();
  // Common: read watermarked WAV from -i 0, optionally pull metadata from original at -i 1.
  const meta = originalInputPath ? ['-i', originalInputPath, '-map_metadata', '1', '-map', '0:a'] : ['-map', '0:a'];
  if (ext === '.mp3') return [...meta, '-c:a', 'libmp3lame', '-b:a', '320k'];
  if (ext === '.flac') return [...meta, '-c:a', 'flac', '-compression_level', '5'];
  if (ext === '.ogg') return [...meta, '-c:a', 'libvorbis', '-q:a', '7'];
  if (ext === '.wav') return [...meta, '-c:a', 'pcm_s16le'];
  return [...meta]; // fall back to ffmpeg's default
}

async function add(inputPath, outputPath, messageHex, keyFilePath) {
  const inExt = path.extname(inputPath).toLowerCase();
  const outExt = path.extname(outputPath).toLowerCase();

  // Fast path: WAV in, WAV out — no transcoding needed.
  if (inExt === '.wav' && outExt === '.wav') {
    return rawAdd(inputPath, outputPath, messageHex, keyFilePath);
  }

  const inWav = inExt === '.wav' ? null : tmpPath('-in.wav');
  const outWav = tmpPath('-out.wav');

  try {
    if (inWav) {
      await ffmpegRun(['-y', '-i', inputPath, '-vn', '-c:a', 'pcm_s16le', inWav]);
    }
    await rawAdd(inWav || inputPath, outWav, messageHex, keyFilePath);
    if (outExt === '.wav') {
      fs.copyFileSync(outWav, outputPath);
    } else {
      await ffmpegRun(['-y', '-i', outWav, ...encodeArgs(outExt, inputPath), outputPath]);
    }
  } finally {
    if (inWav) { try { fs.unlinkSync(inWav); } catch {} }
    try { fs.unlinkSync(outWav); } catch {}
  }
}

async function get(watermarkedPath, keyFilePath) {
  const args = ['get'];
  if (keyFilePath) args.push('--key', keyFilePath);
  args.push(watermarkedPath);
  return run(args);
}

function findHexInJson(obj) {
  if (typeof obj === 'string') {
    const cleaned = obj.replace(/\s+/g, '');
    if (/^[0-9a-f]{32}$/i.test(cleaned)) return cleaned.toLowerCase();
    return null;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = findHexInJson(v);
      if (r) return r;
    }
    return null;
  }
  if (obj && typeof obj === 'object') {
    if (typeof obj.message === 'string') {
      const cleaned = obj.message.replace(/\s+/g, '');
      if (/^[0-9a-f]{32}$/i.test(cleaned)) return cleaned.toLowerCase();
    }
    for (const v of Object.values(obj)) {
      const r = findHexInJson(v);
      if (r) return r;
    }
  }
  return null;
}

async function extractMessage(watermarkedPath, keyFilePath) {
  const jsonPath = path.join(app.getPath('temp'), `audiowmark-${process.pid}-${Date.now()}.json`);
  try {
    const args = ['get', '--json', jsonPath];
    if (keyFilePath) args.push('--key', keyFilePath);
    args.push(watermarkedPath);
    await run(args);
    if (!fs.existsSync(jsonPath)) return null;
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return findHexInJson(data);
  } catch (err) {
    if (/no watermark/i.test(err.message)) return null;
    throw err;
  } finally {
    try { fs.unlinkSync(jsonPath); } catch {}
  }
}

module.exports = { binDir, exePath, masterKeyPath, ensureMasterKey, genKey, add, get, extractMessage };
