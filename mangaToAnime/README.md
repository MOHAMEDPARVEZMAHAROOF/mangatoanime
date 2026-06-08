# MangaToAnime

A Chromium-based desktop application that converts manga PDF panels into anime-styled video clips using Google Gemini image generation and Veo video generation, then stitches them into a continuous fight scene video.

## Features

- **PDF Upload & Panel Selection** — Drag-and-drop manga PDFs, preview all pages, select panels for processing
- **High-Resolution Extraction** — Extract panels at 300 DPI minimum
- **Gemini Image Restyling** — Convert manga panels to anime keyframes via Gemini browser automation or Imagen API
- **Video Prompt Builder** — Auto-generate and customize Veo prompts with action presets
- **Veo Video Generation** — Automated clip generation with continuation chain via seed frames
- **Clip Timeline** — Reorder, preview, delete, and regenerate clips
- **FFmpeg Export** — Stitch all clips into `MangaFight_[timestamp].mp4` on your Desktop

## Requirements

- Node.js 18+
- Windows 10+ or macOS 12+
- Google Gemini account (for browser automation)
- Optional: Gemini API key (for direct Imagen API fallback)

## Installation

```bash
cd mangaToAnime
npm install
npm start
```

## Building Installers

### Windows (.exe)

```bash
npm run build:win
```

Output: `dist/MangaToAnime Setup x.x.x.exe`

### macOS (.dmg)

```bash
npm run build:mac
```

Output: `dist/MangaToAnime-x.x.x.dmg`

## Gemini Login

1. Click **Gemini Login** in the top bar to sign in via Google
2. If sign-in is blocked by security policies, open **Settings** (gear icon)
3. Enable **Bypass Login (use cookie)**
4. Paste your Google session cookie string
5. Save settings — automation will use the cookie to authenticate

## Workflow

1. **Upload PDF** — Drag a manga PDF and select pages
2. **Extract Panels** — High-res PNG extraction to local temp folder
3. **Generate Keyframes** — Gemini converts each panel to anime style; approve or regenerate
4. **Build Video Prompts** — Customize action and camera for each clip
5. **Generate Videos** — Veo creates clips with automatic seed-frame chaining
6. **Manage Clips** — Reorder timeline, preview, regenerate individual clips
7. **Export** — FFmpeg concatenates clips to Desktop

## Settings

| Setting | Description |
|---------|-------------|
| Gemini API Key | Optional direct API access (encrypted local storage) |
| Theme | Solo Leveling, Naruto, Demon Slayer, or Custom |
| Clip Duration | 8s or 10s default |
| Resolution | 1080p or 4K |
| Series Mode | Character anchor descriptions per series |
| General Prompt | Override the default Solo Leveling style prompt |

## Architecture

- **`main.js`** — OS integration, FFmpeg, encrypted settings, native download bridge (`session.on('will-download')`)
- **`preload.js`** — IPC bridge between Electron and UI
- **`renderer/gemini.js`** — Gemini DOM automation inside `<webview>` via `executeJavaScript`
- **`renderer/veo.js`** — Veo video automation inside the same webview
- **`renderer/webview.css`** — Injected styles to clean up Gemini's interface

The `<webview>` uses partition `persist:gemini` so login persists across sessions.

## File Structure

```
mangaToAnime/
  main.js              Electron main process
  preload.js           Context bridge
  renderer/
    index.html         Main UI
    styles.css         Dark theme
    app.js             UI logic
    pdf-handler.js     PDF extraction
    gemini.js          Image generation
    veo.js             Video generation
    ffmpeg.js          Export
  assets/
    logo.png
  package.json
```

## Temp Files

Working files are stored under the app user data directory:

- `extracted/` — Raw panel PNGs
- `keyframes/` — Anime-styled keyframes
- `clips/` — Generated video clips
- `seeds/` — Last-frame seeds for clip chaining

Temp files are cleaned up after final export.

## License

MIT
