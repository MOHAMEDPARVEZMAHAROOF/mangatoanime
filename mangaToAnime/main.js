const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const Store = require('electron-store');
const sharp = require('sharp');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update(app.getName() + 'manga-to-anime-secret')
  .digest();

const store = new Store({
  encryptionKey: ENCRYPTION_KEY.toString('hex').slice(0, 32),
});

let mainWindow = null;
const downloadWaitQueue = [];

const BASE_PROMPT = `You are a professional anime key animator working on an official Solo Leveling animated series production. Your task is to convert the uploaded manga panel into a fully rendered anime production cel.

CRITICAL RULES:
- Preserve EXACTLY: every character pose, body position, facial expression, camera angle, and panel composition from the manga image
- Do NOT add, remove, or reposition any characters or objects
- Do NOT change the perspective or framing
- Only add: color, lighting, linework polish, and anime rendering style

ART STYLE SPECIFICATIONS:
- Studio A-1 Pictures / MAPPA hybrid aesthetic
- Clean bold outlines: 2-3px on characters, 1px on background details
- Cel-shading with 3 light levels: highlight, midtone, shadow
- No watercolor, no painterly texture — clean flat anime production look
- Film grain: subtle 5% overlay
- Aspect ratio: preserve original panel ratio exactly

CHARACTER RENDERING:
Primary male protagonist (whenever present in panel):
- Hair: jet black, slightly blue-tinted highlight sheen, sharp spiky ends
- Eyes: solid glowing violet-purple (#7B3FF0), no pupils, inner light glow effect
- Skin: cool pale tone (#F0EBE3), sharp cheekbones, strong jaw
- Outfit: form-fitting black tactical bodysuit, subtle midnight blue sheen on fabric folds, very faint blue geometric rune patterns on chest and arms
- Shadow aura: deep violet-black particle energy (#1A0533) radiating 2-3cm from body outline, semi-transparent wisps, NOT a solid border
- Expression default: cold, intense, emotionless unless panel shows otherwise

Secondary characters and enemies:
- Monsters: desaturated dark color palette, red or orange glowing eyes, cracked stone or shadow texture on skin
- Human hunters: standard anime skin tones, colored by their rank (S-rank = gold accents, A-rank = silver, lower = no special accent)

LIGHTING SYSTEM:
- Dungeon scenes: single rim light from below or behind, deep shadow fill from above, ambient color = dark teal (#0D2B2E)
- Combat scenes: dramatic side lighting, hard shadows, impact flash = pure white (#FFFFFF) with purple (#6B21F0) fringe
- Emotional scenes: soft diffused top light, warmer ambient
- All scenes: always have at least one strong specular highlight on character eyes and any weapons or power effects

POWER EFFECT RENDERING:
Shadow energy / monarch powers:
- Base color: #0D0020 (near black with purple tint)
- Particle layer: #7B3FF0 (violet), semi-transparent, scattered
- Outer glow: #4A00CC (deep purple), 8-10px soft edge
- Motion blur on fast-moving energy: 15px directional blur
- Shadow soldiers (if visible): silhouette only, solid #0A0015, no facial detail, faint purple edge glow

Gate / dungeon portals:
- Frame color: deep crimson #8B0000 to black gradient
- Inner void: absolute black #000000 with red particle scatter
- Light leak: thin bright red-orange line along inner portal edge

BACKGROUND RENDERING:
- Dungeon walls: dark grey (#1A1A1A) stone, cracked texture implied with sparse highlight lines, no detailed texture fill
- Ground: reflective dark surface, shows faint character shadow reflection
- Sky (if visible): deep navy to black gradient, no stars unless panel shows them
- Keep backgrounds simpler than characters — characters are always the focus

LINEWORK POLISH:
- Clean up any rough manga hatching — replace with smooth cel shading
- Smooth all jagged edges on character outlines
- Keep speed lines if present in original panel — color them white with slight motion blur
- Impact lines: bright white center fading to transparent at edges

COLOR GRADING (apply as final step):
- Overall saturation: +15% on characters, -10% on backgrounds
- Contrast: +20% globally
- Color temperature: cool overall (shift slightly blue-teal)
- Vignette: subtle dark edge vignette, 20% opacity
- Final look reference: cinematic anime screenshot, NOT a comic panel

OUTPUT REQUIREMENTS:
- Single full illustration, no panel borders, no speech bubbles, no text
- Resolution: maximum available
- Format: PNG with full color depth
- The result must look indistinguishable from an actual Solo Leveling anime production frame as released by A-1 Pictures / MAPPA

DO NOT:
- Add any new characters not in the original panel
- Change any poses or compositions
- Add text, watermarks, or artist signatures
- Make it look painterly, watercolor, or Western comic style
- Use bright saturated colors on backgrounds
- Make the shadow aura a solid black border — it must be wispy and particle-based`;

const THEME_PROMPTS = {
  'solo-leveling': { palette: 'deep blacks, vivid purples and blues', accent: '#7B5CF0' },
  naruto: { palette: 'vibrant oranges, deep blues', accent: '#FF6B00' },
  'demon-slayer': { palette: 'crimson reds, charcoal blacks', accent: '#E63946' },
  custom: { palette: 'user-defined', accent: '#7B5CF0' },
};

const SERIES_ANCHORS = {
  'solo-leveling':
    'Korean manhwa cel-shaded anime. Male hunter, short black hair, glowing violet eyes, black combat armor, dark shadow aura, pale skin. This character must appear identical in every frame.',
};

function getWorkDirs() {
  const base = path.join(app.getPath('userData'), 'mangaToAnime');
  return {
    base,
    extracted: path.join(base, 'extracted'),
    keyframes: path.join(base, 'keyframes'),
    clips: path.join(base, 'clips'),
    seeds: path.join(base, 'seeds'),
    downloads: path.join(base, 'downloads'),
  };
}

async function ensureDirs() {
  const dirs = getWorkDirs();
  for (const dir of Object.values(dirs)) {
    await fsp.mkdir(dir, { recursive: true });
  }
  return dirs;
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function setupDownloadBridge() {
  const ses = session.fromPartition('persist:gemini');

  ses.on('will-download', (event, item) => {
    const dirs = getWorkDirs();
    const ext = path.extname(item.getFilename()) || '.png';
    const savePath = path.join(dirs.downloads, `gemini_${Date.now()}${ext}`);
    item.setSavePath(savePath);

    item.once('done', (_e, state) => {
      const waiter = downloadWaitQueue.shift();
      if (!waiter) return;

      if (state === 'completed') {
        waiter.resolve({ success: true, path: savePath });
      } else {
        waiter.reject(new Error(`Download ${state}`));
      }
    });
  });
}

async function injectCookies(cookieString) {
  const ses = session.fromPartition('persist:gemini');
  if (!cookieString?.trim()) return;

  const pairs = cookieString.split(';').map((s) => s.trim()).filter(Boolean);
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    try {
      await ses.cookies.set({
        url: 'https://gemini.google.com',
        name,
        value,
        domain: '.google.com',
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'no_restriction',
      });
    } catch {
      // continue
    }
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0a0a0a',
    title: 'MangaToAnime',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
    icon: path.join(__dirname, 'assets', 'logo.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildVideoPrompt(keyframeDescription, action, cameraMove) {
  return `Anime cel-shaded style, cinematic. Starting from this exact frame: ${keyframeDescription}. ${action}. Camera: ${cameraMove}. Slow-motion cinematic, 3D depth of field, volumetric lighting, 4K quality, 24fps film grain. END FREEZE: hold final pose.`;
}

async function extractLastFrame(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput('99%')
      .frames(1)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

async function cleanupTempFiles() {
  const dirs = getWorkDirs();
  for (const key of ['extracted', 'keyframes', 'clips', 'seeds', 'downloads']) {
    const dir = dirs[key];
    if (fs.existsSync(dir)) {
      const files = await fsp.readdir(dir);
      await Promise.all(files.map((f) => fsp.unlink(path.join(dir, f)).catch(() => {})));
    }
  }
}

function registerIpcHandlers() {
  ipcMain.handle('get-settings', () => ({
    apiKey: store.get('apiKey', ''),
    theme: store.get('theme', 'solo-leveling'),
    customColor: store.get('customColor', '#7B5CF0'),
    clipDuration: store.get('clipDuration', 8),
    resolution: store.get('resolution', '1080p'),
    series: store.get('series', 'solo-leveling'),
    geminiCookie: store.get('geminiCookie', ''),
    bypassLogin: store.get('bypassLogin', false),
    customGeneralPrompt: store.get('customGeneralPrompt', ''),
  }));

  ipcMain.handle('save-settings', (_, settings) => {
    Object.entries(settings).forEach(([key, val]) => {
      if (val !== undefined) store.set(key, val);
    });
    return { success: true };
  });

  ipcMain.handle('get-work-dirs', async () => {
    await ensureDirs();
    return getWorkDirs();
  });

  ipcMain.handle('select-pdf', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('read-file-buffer', async (_, filePath) => {
    return fsp.readFile(filePath);
  });

  ipcMain.handle('read-file-base64', async (_, filePath) => {
    const buf = await fsp.readFile(filePath);
    return buf.toString('base64');
  });

  ipcMain.handle('save-extracted-panel', async (_, { pageIndex, dataUrl }) => {
    const dirs = await ensureDirs();
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const filename = `panel_${String(pageIndex + 1).padStart(3, '0')}.png`;
    const outputPath = path.join(dirs.extracted, filename);
    await fsp.writeFile(outputPath, Buffer.from(base64, 'base64'));
    return outputPath;
  });

  ipcMain.handle('save-keyframe', async (_, { panelIndex, sourcePath }) => {
    const dirs = await ensureDirs();
    const outName = `keyframe_${String(panelIndex + 1).padStart(3, '0')}.png`;
    const outPath = path.join(dirs.keyframes, outName);
    await fsp.copyFile(sourcePath, outPath);
    return outPath;
  });

  ipcMain.handle('save-clip', async (_, { clipIndex, sourcePath }) => {
    const dirs = await ensureDirs();
    const outName = `clip_${String(clipIndex + 1).padStart(3, '0')}.mp4`;
    const outPath = path.join(dirs.clips, outName);
    await fsp.copyFile(sourcePath, outPath);
    return outPath;
  });

  ipcMain.handle('extract-seed-frame', async (_, { clipPath, clipIndex }) => {
    const dirs = await ensureDirs();
    const seedName = `seed_${String(clipIndex + 2).padStart(3, '0')}.png`;
    const seedPath = path.join(dirs.seeds, seedName);
    await extractLastFrame(clipPath, seedPath);
    return seedPath;
  });

  ipcMain.handle('optimize-prompt', async (_, { imagePath, themeId, customPalette }) => {
    const settings = {
      theme: store.get('theme', 'solo-leveling'),
      customColor: store.get('customColor', '#7B5CF0'),
    };
    const customPrompt = store.get('customGeneralPrompt', '');
    const base = customPrompt.trim() || BASE_PROMPT;
    const metadata = await sharp(imagePath).metadata();
    const isLandscape = metadata.width > metadata.height;
    const theme = THEME_PROMPTS[themeId || settings.theme] || THEME_PROMPTS['solo-leveling'];

    let prompt = base;
    if ((themeId || settings.theme) !== 'solo-leveling') {
      const t = themeId || settings.theme;
      prompt += `\n\nCOLOR PALETTE OVERRIDE: ${t === 'custom' ? customPalette || settings.customColor : theme.palette}`;
    }
    if (isLandscape) {
      prompt = 'Landscape orientation. Wide cinematic framing.\n\n' + prompt;
    }
    const series = store.get('series', 'solo-leveling');
    const anchor = SERIES_ANCHORS[series];
    if (anchor) prompt += `\n\nCHARACTER ANCHOR: ${anchor}`;
    return prompt;
  });

  ipcMain.handle('inject-gemini-cookies', async (_, cookie) => {
    await injectCookies(cookie);
    return { success: true };
  });

  ipcMain.handle('wait-for-download', (_, timeoutMs = 300000) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = downloadWaitQueue.findIndex((w) => w.reject === reject);
        if (idx >= 0) downloadWaitQueue.splice(idx, 1);
        reject(new Error('Download timed out'));
      }, timeoutMs);

      downloadWaitQueue.push({
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  });

  ipcMain.handle('build-video-prompt', (_, { description, action, cameraMove }) => {
    return buildVideoPrompt(description, action, cameraMove);
  });

  ipcMain.handle('get-video-duration', async (_, videoPath) => {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) resolve(0);
        else resolve(metadata.format.duration || 0);
      });
    });
  });

  ipcMain.handle('generate-thumbnail', async (_, videoPath) => {
    const dirs = await ensureDirs();
    const thumbPath = path.join(dirs.downloads, `thumb_${path.basename(videoPath, '.mp4')}.png`);
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: ['00:00:01'],
          filename: path.basename(thumbPath),
          folder: dirs.downloads,
          size: '320x180',
        })
        .on('end', () => resolve(thumbPath))
        .on('error', reject);
    });
  });

  ipcMain.handle('export-video', async (_, { clipPaths }) => {
    const dirs = await ensureDirs();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const desktop = app.getPath('desktop');
    const outputPath = path.join(desktop, `MangaFight_${timestamp}.mp4`);
    const listPath = path.join(dirs.base, 'filelist.txt');

    const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    await fsp.writeFile(listPath, listContent);

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(outputPath)
        .on('progress', (progress) => {
          sendToRenderer('export-progress', {
            percent: progress.percent || 0,
            timemark: progress.timemark,
          });
        })
        .on('end', async () => {
          await cleanupTempFiles();
          resolve({ success: true, path: outputPath });
        })
        .on('error', reject)
        .run();
    });
  });

  ipcMain.handle('cleanup-temp', async () => {
    await cleanupTempFiles();
    return { success: true };
  });

  ipcMain.handle('open-path', async (_, filePath) => {
    await shell.openPath(filePath);
  });

  ipcMain.handle('show-item-in-folder', async (_, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('delete-file', async (_, filePath) => {
    try {
      await fsp.unlink(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-base-prompt', () => BASE_PROMPT);

  ipcMain.handle('get-webview-css', () => {
    const cssPath = path.join(__dirname, 'renderer', 'webview.css');
    return fsp.readFile(cssPath, 'utf8');
  });
}

app.whenReady().then(async () => {
  await ensureDirs();
  setupDownloadBridge();
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
