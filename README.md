# MangaToAnime

Convert manga PDF panels into anime-styled fight scene videos.

## Use on Vercel (browser — no install)

**Live app:** https://web-navy-phi-11.vercel.app

1. Open the URL in Chrome or Edge
2. Upload a manga PDF → select pages → **Process Selected Panels**
3. Click **Open Gemini Popup** → sign in to Google
4. Click **I'm signed in to Gemini**
5. Click **▶ Start Restyling Automation**
6. For each panel: upload panel in Gemini → paste copied prompt → download result → **Upload Result** in the app
7. Approve keyframes → build video prompts → upload clips → export MP4

**Optional:** Add a Gemini API key in Settings for fully automatic keyframe generation (no manual Gemini steps).

## Desktop app (full Gemini automation inside app)

For embedded Chromium webview with automatic clicking (no manual steps):

```bash
cd mangaToAnime
npm install
npm start
```

Build Windows `.exe`:

```bash
npm run build:win:unpacked
```
