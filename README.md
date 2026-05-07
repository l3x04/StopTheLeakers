# StopTheLeakers

Audio watermarking tool for DJs and music producers. Generates per-recipient watermarked copies of a track and identifies leaks by scanning a suspected file.

---

## How it works

When you generate copies, the app makes microscopic adjustments to the actual audio — slightly nudging the volume of certain frequencies in a pattern that encodes a unique ID per recipient. The changes sit below what human ears can pick up, but a computer reading the file with the same key can detect the pattern and decode the ID.

Every recipient receives a physically different audio file, each carrying their own ID baked into the music itself. When a track leaks, drop it into **Scan** and the app extracts the ID and tells you which recipient it was sent to.

---

## Install (end users)

Download `StopTheLeakers-X.Y.Z-setup.exe` from [Releases](../../releases) and run it.

Windows SmartScreen will warn about an "unknown publisher" because the installer is unsigned — click **More info → Run anyway**.

On first launch the app generates a `master.key` at `%APPDATA%\stoptheleakers\master.key`. **Back this file up.** Without it, watermarks generated on this machine become unreadable forever.

---

## Building from source

The app has two halves that compile independently:

1. **`audiowmark.exe` + DLLs** (the C++ watermarking engine) — built once via Cygwin/MinGW, committed into `resources/bin/`. This is the painful step.
2. **The Electron wrapper** (Node + HTML/CSS/JS) — `npm install`, `npm run dist`. Easy.

If you cloned the repo and `resources/bin/` already contains `audiowmark.exe` + DLLs, you can skip straight to **Step 2**.

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Windows 10 / 11 (x64) | — | The build is Windows-only. |
| Node.js | ≥ 20 | Use Node 20 LTS or newer. |
| Cygwin | latest | For the audiowmark build only. |
| MinGW-w64 | x86_64-13.x posix-seh-msvcrt | For zita-resampler/CMake build. |
| CMake | ≥ 3.16 | Standard Windows installer, "add to PATH". |
| 7-Zip | latest | For extracting the MinGW archive. |

### Step 1 — Build `audiowmark.exe`

#### 1.1 Install Cygwin packages

Run the Cygwin setup, mark these for install:

```
gcc-core gcc-g++ make
mingw64-x86_64-gcc-core mingw64-x86_64-gcc-g++
libfftw3-devel libsndfile-devel libgcrypt-devel libmpg123-devel
zstd wget unzip
```

#### 1.2 Install native Windows toolchain

- Download MinGW-w64 from [niXman/mingw-builds-binaries](https://github.com/niXman/mingw-builds-binaries/releases) — pick a `x86_64-13.x-release-posix-seh-msvcrt` `.7z`. Extract to `C:\` so you have `C:\mingw64\`.
- Add `C:\mingw64\bin` to your **System PATH at position 0**.
- Install CMake with "Add to system PATH".
- Verify in a fresh `cmd`:
  ```
  mingw32-make --version
  cmake --version
  ```

#### 1.3 Get sources

```bash
# In Cygwin terminal
cd /cygdrive/c/path/to/StopTheLeakers/build-tools
wget https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip
wget https://github.com/swesterfeld/audiowmark/releases/download/0.6.5/audiowmark-0.6.5.tar.zst
wget -O zita-resampler-main.zip https://github.com/digital-stage/zita-resampler/archive/refs/heads/main.zip

zstd -d audiowmark-0.6.5.tar.zst && tar -xf audiowmark-0.6.5.tar
unzip -q zita-resampler-main.zip
unzip -q ffmpeg-master-latest-win64-gpl-shared.zip
```

#### 1.4 Build zita-resampler inside Cygwin

```bash
cd zita-resampler-main/source
g++ -c -fPIC -O2 -I. resampler.cc vresampler.cc resampler-table.cc cresampler.cc
g++ -shared -o libzita-resampler.dll *.o -Wl,--out-implib,libzita-resampler.dll.a

mkdir -p /usr/local/include/zita-resampler /usr/local/lib /usr/local/bin
cp zita-resampler/*.h /usr/local/include/zita-resampler/
cp libzita-resampler.dll.a /usr/local/lib/
cp libzita-resampler.dll /usr/local/bin/
```

#### 1.5 Build audiowmark

```bash
cd ../../audiowmark-0.6.5
./configure --host=x86_64-pc-cygwin \
  CPPFLAGS="-I/usr/local/include" \
  LDFLAGS="-L/usr/local/lib"
make -j4
```

The real binary lives at `src/.libs/audiowmark.exe` (`src/audiowmark.exe` is a libtool wrapper — ignore it).

#### 1.6 Stage artifacts into `resources/bin/`

```bash
DEST=/cygdrive/c/path/to/StopTheLeakers/resources/bin

cp src/.libs/audiowmark.exe $DEST/

# Cygwin runtime DLLs
cp /usr/bin/cygwin1.dll \
   /usr/bin/cygfftw3f-3.dll \
   /usr/bin/cygmpg123-0.dll \
   /usr/bin/cyggcrypt-20.dll \
   /usr/bin/cygsndfile-1.dll \
   /usr/bin/cygstdc++-6.dll \
   /usr/bin/cyggcc_s-seh-1.dll \
   /usr/bin/cyggpg-error-0.dll \
   /usr/bin/cygmp3lame-0.dll \
   /usr/bin/cygFLAC-8.dll \
   /usr/bin/cygogg-0.dll \
   /usr/bin/cygopus-0.dll \
   /usr/bin/cygvorbis-0.dll \
   /usr/bin/cygvorbisenc-2.dll \
   /usr/bin/cygiconv-2.dll \
   /usr/bin/cygintl-8.dll \
   $DEST/

cp /usr/local/bin/libzita-resampler.dll $DEST/

# FFmpeg (used at runtime for format conversion)
cd ../build-tools/ffmpeg-master-latest-win64-gpl-shared/bin
cp ffmpeg.exe ffprobe.exe \
   avcodec-*.dll avdevice-*.dll avfilter-*.dll avformat-*.dll avutil-*.dll \
   swresample-*.dll swscale-*.dll \
   $DEST/
```

Smoke test from a non-Cygwin `cmd`:

```
cd resources\bin
audiowmark.exe --help
```

If it prints the usage, you're done with Step 1.

### Step 2 — Build the Electron app

```cmd
npm install
npm start
```

`npm start` opens the dev window. Use it to verify the bundled `audiowmark.exe` is reachable (Watermark → Verify setup).

> **Cygwin note:** always run `npm start` from a regular Windows `cmd` or PowerShell. Running it from Cygwin/Git-Bash makes Electron's main-process API unavailable — `require('electron')` returns a path string instead of the API. cmd works fine.

### Step 3 — Package as installer

Enable **Windows Developer Mode** once (Settings → Privacy & security → For developers → Developer Mode ON). This grants the symlink-creation privilege that electron-builder's `winCodeSign` extraction step requires.

Then in `cmd`:

```
npm run dist
```

Output: `dist\StopTheLeakers-X.Y.Z-setup.exe`. Double-click to test locally before publishing.

#### Regenerating the app icon

If you change `assets/icon.svg`, regenerate the multi-size `icon.ico`:

```
npm run build:icon
```

---

## Architecture

```
src/
├── main/                  Electron main process (Node)
│   ├── main.js            App lifecycle, window, IPC handlers
│   ├── preload.js         contextBridge between renderer ↔ main
│   ├── audiowmark.js      spawn() wrapper around audiowmark.exe + ffmpeg pipeline
│   └── db.js              JSON store for {id → recipient, source, date}
└── renderer/              UI (sandboxed Chromium)
    ├── index.html
    ├── styles.css
    └── app.js
resources/bin/             Bundled audiowmark.exe + ffmpeg + DLLs (~250MB)
assets/icon.{svg,ico}      App icon
scripts/build-icon.js      Regenerates icon.ico from icon.svg
```

### How a watermark gets generated

1. User picks an input audio file, output folder, copy count, and recipient names.
2. For each copy, a fresh ID is allocated.
3. If the input isn't already WAV, ffmpeg decodes it to a temp WAV (lossless intermediate).
4. `audiowmark add --key master.key tempIn.wav tempOut.wav <hex>` embeds the ID.
5. ffmpeg re-encodes the watermarked WAV to the original format.
6. The mapping `{id, recipient, sourceTrack, outputPath, batchId, createdAt}` is appended to `%APPDATA%\stoptheleakers\db.json`.

### How a scan resolves a recipient

1. `audiowmark get --json out.json --key master.key suspect.mp3` extracts the embedded ID.
2. The renderer walks the JSON for the 32-char hex message.
3. `db.findById(id)` returns the recipient record.

### Persistence

| Path | Purpose |
|------|---------|
| `%APPDATA%\stoptheleakers\master.key` | The watermarking key. **Critical** — losing it makes all watermarks unreadable. |
| `%APPDATA%\stoptheleakers\db.json` | Mapping of watermark IDs to recipients. Lose this and watermarks become orphaned (still detectable, but you don't know who they were sent to). |

---

## Credits


- **[audiowmark](https://github.com/swesterfeld/audiowmark)** by Stefan Westerfeld — the spread-spectrum watermarking engine that does the actual work. The whole point of this app is to put a friendlier face on it for music producers. GPLv3.
- **[FFmpeg](https://ffmpeg.org/)** — handles format conversion to and from lossless WAV around the watermarking step, so quality stays high through MP3/FLAC/OGG round-trips and ID3 tags get preserved.
- **[zita-resampler](https://github.com/digital-stage/zita-resampler)** (CMake fork by digital-stage, original by Fons Adriaensen) — high-quality resampling used inside audiowmark.
- **[Electron](https://www.electronjs.org/)** + **[electron-builder](https://www.electron.build/)** — desktop app shell and Windows installer pipeline.
- **[Inter](https://rsms.me/inter/)** by Rasmus Andersson — the typeface used throughout the UI.
- Cygwin runtime + **lame**, **libsndfile**, **fftw3**, **libgcrypt**, **mpg123**, **ogg / vorbis / opus / FLAC** — the audio codec stack that gives audiowmark its format coverage.

## License

audiowmark is GPLv3 — apps that ship the binary inherit that license. This wrapper is released under the same terms.
