'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { extractPageHighRes, loadPdf, renderAllThumbnails } from '@/lib/pdf';
import { ACTION_PRESETS, buildVideoPrompt, optimizePrompt } from '@/lib/prompts';

const STEPS = [
  'PDF Upload',
  'Panel Extraction',
  'Anime Keyframes',
  'Video Prompts',
  'Video Generation',
  'Clip Timeline',
  'Export',
];

type Thumb = { pageIndex: number; pageNum: number; dataUrl: string };
type Panel = Thumb & { path?: string };
type Keyframe = {
  panel: Panel;
  path: string;
  prompt?: string;
  approved: boolean;
  index: number;
  description?: string;
};
type Clip = {
  path: string;
  blobUrl: string;
  duration: number;
  thumbnail?: string;
  clipIndex: number;
  prompt?: string;
};

type Settings = {
  apiKey: string;
  theme: string;
  customColor: string;
  clipDuration: number;
  resolution: string;
  series: string;
  customGeneralPrompt: string;
};

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  theme: 'solo-leveling',
  customColor: '#7B5CF0',
  clipDuration: 8,
  resolution: '1080p',
  series: 'solo-leveling',
  customGeneralPrompt: '',
};

function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve({ width: 800, height: 1200 });
    img.src = dataUrl;
  });
}

export default function MangaApp() {
  const [step, setStep] = useState(1);
  const [thumbnails, setThumbnails] = useState<Thumb[]>([]);
  const [selectedPages, setSelectedPages] = useState<Thumb[]>([]);
  const [extractedPanels, setExtractedPanels] = useState<Panel[]>([]);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [statusLog, setStatusLog] = useState<{ msg: string; type?: string }[]>([
    { msg: 'MangaToAnime Web ready — running on Vercel' },
  ]);
  const [genStatus, setGenStatus] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [extractPct, setExtractPct] = useState(0);
  const [videoPct, setVideoPct] = useState(0);
  const [exportPct, setExportPct] = useState(0);
  const [exportedUrl, setExportedUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [showPdfGrid, setShowPdfGrid] = useState(false);
  const [showGeminiPanel, setShowGeminiPanel] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const manualKeyframeRef = useRef<HTMLInputElement>(null);
  const manualClipRef = useRef<HTMLInputElement>(null);
  const pendingKeyframeIndex = useRef<number | null>(null);
  const pendingClipIndex = useRef<number | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('mangatoanime-settings');
    if (saved) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
    document.body.className = settings.theme === 'naruto' ? 'theme-naruto' : settings.theme === 'demon-slayer' ? 'theme-demon-slayer' : '';
    if (settings.theme === 'custom') {
      document.documentElement.style.setProperty('--accent', settings.customColor);
    }
  }, [settings.theme, settings.customColor]);

  const log = useCallback((msg: string, type = '') => {
    setStatusLog((prev) => [{ msg: `[${new Date().toLocaleTimeString()}] ${msg}`, type }, ...prev].slice(0, 50));
  }, []);

  const saveSettings = () => {
    localStorage.setItem('mangatoanime-settings', JSON.stringify(settings));
    setShowSettings(false);
    log('Settings saved', 'success');
  };

  const handlePdf = async (file: File) => {
    try {
      log('Loading PDF...');
      const buf = await file.arrayBuffer();
      const numPages = await loadPdf(buf);
      log(`Loaded PDF with ${numPages} pages`);
      const thumbs = await renderAllThumbnails();
      setThumbnails(thumbs);
      setShowPdfGrid(true);
    } catch (e) {
      log(`PDF error: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
    }
  };

  const togglePage = (thumb: Thumb) => {
    setSelectedPages((prev) => {
      const exists = prev.find((p) => p.pageIndex === thumb.pageIndex);
      if (exists) return prev.filter((p) => p.pageIndex !== thumb.pageIndex);
      return [...prev, thumb].sort((a, b) => a.pageIndex - b.pageIndex);
    });
  };

  const startExtraction = async () => {
    if (!selectedPages.length) return;
    setStep(2);
    const panels: Panel[] = [];
    for (let i = 0; i < selectedPages.length; i++) {
      const p = selectedPages[i];
      const dataUrl = await extractPageHighRes(p.pageIndex);
      panels.push({ ...p, path: dataUrl, dataUrl });
      setExtractPct(((i + 1) / selectedPages.length) * 100);
    }
    setExtractedPanels(panels);
    log(`Extracted ${panels.length} panels`, 'success');
    await startKeyframes(panels);
  };

  const generateKeyframeApi = async (panel: Panel, index: number) => {
    const dims = await getImageDimensions(panel.dataUrl);
    const prompt = optimizePrompt({
      width: dims.width,
      height: dims.height,
      theme: settings.theme,
      customColor: settings.customColor,
      customGeneralPrompt: settings.customGeneralPrompt,
    });

    const res = await fetch('/api/generate-keyframe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: settings.apiKey,
        imageBase64: panel.dataUrl,
        width: dims.width,
        height: dims.height,
        theme: settings.theme,
        customColor: settings.customColor,
        customGeneralPrompt: settings.customGeneralPrompt,
        prompt,
      }),
    });
    return res.json();
  };

  const startKeyframes = async (panels: Panel[]) => {
    setStep(3);
    setShowGeminiPanel(true);
    const results: Keyframe[] = [];

    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      setGenStatus(`Generating keyframe ${i + 1} of ${panels.length}...`);

      const result = await generateKeyframeApi(panel, i);

      if (result.success && result.imageBase64) {
        results.push({
          panel,
          path: result.imageBase64,
          prompt: result.prompt,
          approved: false,
          index: i,
        });
        log(`Keyframe ${i + 1} generated`, 'success');
      } else {
        log(result.error || 'Generation failed — use Open Gemini + Upload', 'error');
        results.push({
          panel,
          path: '',
          prompt: result.prompt,
          approved: false,
          index: i,
        });
      }
      setKeyframes([...results]);
    }
    setGenStatus('');
  };

  const openGemini = () => {
    window.open('https://gemini.google.com/app', '_blank', 'noopener,noreferrer');
    log('Opened Gemini in new tab — sign in, use Create Image, paste prompt, download result');
    setShowLogin(false);
  };

  const approveKeyframe = (index: number) => {
    setKeyframes((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], approved: true };
      if (next.every((k) => k.approved && k.path)) {
        setTimeout(() => startPromptBuilder(next), 400);
      }
      return next;
    });
  };

  const startPromptBuilder = (kfs: Keyframe[]) => {
    setStep(4);
    setShowGeminiPanel(false);
    setKeyframes(kfs.map((k) => ({
      ...k,
      description: k.description || 'Anime character in dynamic combat scene with dramatic lighting',
    })));
  };

  const startVideoGen = async () => {
    setStep(5);
    setShowGeminiPanel(true);
    const promptEls = document.querySelectorAll<HTMLTextAreaElement>('.input-prompt');
    const prompts = Array.from(promptEls).map((el) => el.value);
    const newClips: Clip[] = [];

    for (let i = 0; i < keyframes.length; i++) {
      setGenStatus(`Clip ${i + 1}: Open Gemini → Video mode → upload keyframe → paste prompt → download`);
      setVideoPct(((i + 1) / keyframes.length) * 50);
      log(`Generate clip ${i + 1} in Gemini, then click Upload Clip below`);
      pendingClipIndex.current = i;
      // Wait for manual upload via button
      break; // User uploads clips one by one via UI
    }

    if (newClips.length) setClips(newClips);
    setGenStatus('Upload each clip using the Upload Clip button, then continue to timeline');
  };

  const handleManualKeyframeUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const idx = pendingKeyframeIndex.current ?? keyframes.findIndex((k) => !k.path);
    if (!file || idx < 0) return;
    const reader = new FileReader();
    reader.onload = () => {
      const path = reader.result as string;
      setKeyframes((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], path };
        return next;
      });
      log(`Keyframe ${idx + 1} uploaded manually`, 'success');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleManualClipUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const idx = pendingClipIndex.current ?? clips.length;
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = blobUrl;
    video.onloadedmetadata = () => {
      const clip: Clip = {
        path: file.name,
        blobUrl,
        duration: video.duration || settings.clipDuration,
        clipIndex: idx,
      };
      setClips((prev) => [...prev, clip]);
      log(`Clip ${idx + 1} uploaded`, 'success');
      if (clips.length + 1 >= keyframes.length) {
        setStep(6);
        setGenStatus('');
      }
    };
    e.target.value = '';
  };

  const exportVideo = async () => {
    if (!clips.length) {
      log('No clips to export', 'error');
      return;
    }
    setGenStatus('Stitching video with FFmpeg (browser)...');
    try {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { fetchFile, toBlobURL } = await import('@ffmpeg/util');
      const ffmpeg = new FFmpeg();
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      for (let i = 0; i < clips.length; i++) {
        const data = await fetchFile(clips[i].blobUrl);
        await ffmpeg.writeFile(`clip${i}.mp4`, data);
      }

      const listContent = clips.map((_, i) => `file 'clip${i}.mp4'`).join('\n');
      await ffmpeg.writeFile('list.txt', listContent);
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'output.mp4']);
      const data = await ffmpeg.readFile('output.mp4');
      const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
      const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      setExportedUrl(url);
      setExportPct(100);
      setGenStatus('');
      log('Export complete!', 'success');
    } catch (e) {
      log(`Export failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
      setGenStatus('');
    }
  };

  const stepName = STEPS[step - 1];

  return (
    <div className="app">
      <header className="top-bar">
        <div className="logo-area">
          <div className="logo" style={{ background: 'linear-gradient(135deg,#7B5CF0,#a78bfa)', width: 32, height: 32, borderRadius: 8 }} />
          <h1>MangaToAnime</h1>
          <span style={{ fontSize: 11, color: '#7B5CF0', marginLeft: 8 }}>WEB</span>
        </div>
        <div className="step-indicator">
          <span className="step-label">Step {step}/7</span>
          <span className="step-name">{stepName}</span>
        </div>
        <div className="top-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setShowLogin(true)}>Gemini Login</button>
          <button type="button" className="btn btn-icon" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </header>

      <div className="main-layout">
        <aside className="sidebar sidebar-left">
          <h2>Panel Queue</h2>
          <div className="queue-list">
            {selectedPages.length === 0 ? (
              <p className="empty-state">No panels selected</p>
            ) : (
              selectedPages.map((p) => (
                <div key={p.pageIndex} className="queue-item">
                  <img src={p.dataUrl} alt="" />
                  <span>Page {p.pageNum}</span>
                </div>
              ))
            )}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!selectedPages.length}
            onClick={startExtraction}
          >
            Process Selected Panels
          </button>
        </aside>

        <main className="workspace">
          {step === 1 && (
            <section className="step-panel active">
              {!showPdfGrid ? (
                <div
                  className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files[0];
                    if (f?.name.toLowerCase().endsWith('.pdf')) handlePdf(f);
                  }}
                >
                  <div className="drop-icon">📄</div>
                  <p>Drag & drop a manga PDF here</p>
                  <p className="sub">or click to browse</p>
                  <input ref={fileRef} type="file" accept=".pdf" hidden onChange={(e) => e.target.files?.[0] && handlePdf(e.target.files[0])} />
                </div>
              ) : (
                <div className="pdf-grid">
                  {thumbnails.map((t) => (
                    <div
                      key={t.pageIndex}
                      className={`pdf-thumb ${selectedPages.some((p) => p.pageIndex === t.pageIndex) ? 'selected' : ''}`}
                      onClick={() => togglePage(t)}
                    >
                      <img src={t.dataUrl} alt="" />
                      <span className="page-num">{t.pageNum}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {step === 2 && (
            <section className="step-panel active">
              <h2>Extracting Panels</h2>
              <div className="progress-container">
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${extractPct}%` }} /></div>
                <p>Extracting at 300 DPI...</p>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="step-panel active">
              <h2>Anime Keyframe Generation</h2>
              <div className="keyframe-list">
                {(keyframes.length ? keyframes : extractedPanels.map((p, i) => ({ panel: p, path: '', approved: false, index: i } as Keyframe))).map((kf) => (
                  <div key={kf.index} className={`keyframe-card ${kf.approved ? 'approved' : ''}`}>
                    <h3>Panel {kf.index + 1}</h3>
                    <div className="keyframe-compare">
                      <figure><img src={kf.panel.dataUrl} alt="" /><figcaption>Before</figcaption></figure>
                      <figure>
                        {kf.path ? <img src={kf.path} alt="" /> : <div className="spinner" style={{ margin: '40px auto' }} />}
                        <figcaption>After</figcaption>
                      </figure>
                    </div>
                    <div className="keyframe-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { pendingKeyframeIndex.current = kf.index; manualKeyframeRef.current?.click(); }}>Upload Result</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
                        const r = await generateKeyframeApi(kf.panel, kf.index);
                        if (r.success) setKeyframes((prev) => { const n = [...prev]; n[kf.index] = { ...n[kf.index], path: r.imageBase64, prompt: r.prompt }; return n; });
                      }}>Regenerate</button>
                      <button type="button" className="btn btn-primary btn-sm" disabled={!kf.path} onClick={() => approveKeyframe(kf.index)}>Approve</button>
                    </div>
                  </div>
                ))}
              </div>
              <input ref={manualKeyframeRef} type="file" accept="image/*" hidden onChange={handleManualKeyframeUpload} />
            </section>
          )}

          {step === 4 && (
            <section className="step-panel active">
              <h2>Video Prompt Builder</h2>
              <div className="prompt-builder">
                {keyframes.map((kf, i) => {
                  const preset = ACTION_PRESETS['combat-strike'];
                  const defaultPrompt = buildVideoPrompt(kf.description || '', preset.action, preset.camera);
                  return (
                    <div key={i} className="prompt-card">
                      <h3>Clip {i + 1}</h3>
                      {kf.path && <img src={kf.path} alt="" />}
                      <div className="preset-buttons">
                        {Object.keys(ACTION_PRESETS).map((key) => (
                          <button key={key} type="button" className="preset-btn" onClick={(e) => {
                            const p = ACTION_PRESETS[key];
                            const card = (e.target as HTMLElement).closest('.prompt-card');
                            if (!card) return;
                            (card.querySelector('.input-action') as HTMLInputElement).value = p.action;
                            (card.querySelector('.input-camera') as HTMLInputElement).value = p.camera;
                            (card.querySelector('.input-prompt') as HTMLTextAreaElement).value = buildVideoPrompt(kf.description || '', p.action, p.camera);
                          }}>{key.replace(/-/g, ' ')}</button>
                        ))}
                      </div>
                      <div className="form-group"><label>Action</label><input className="input-action" defaultValue={preset.action} /></div>
                      <div className="form-group"><label>Camera</label><input className="input-camera" defaultValue={preset.camera} /></div>
                      <div className="form-group"><label>Prompt</label><textarea className="input-prompt" rows={4} defaultValue={defaultPrompt} /></div>
                    </div>
                  );
                })}
                <button type="button" className="btn btn-primary btn-lg" onClick={startVideoGen}>Start Video Generation</button>
              </div>
            </section>
          )}

          {step === 5 && (
            <section className="step-panel active">
              <h2>Video Generation</h2>
              <div className="progress-container">
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${videoPct}%` }} /></div>
                <p>{genStatus || 'Use Gemini for video, then upload clips'}</p>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => manualClipRef.current?.click()}>Upload Clip</button>
              <button type="button" className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => setStep(6)}>Continue to Timeline</button>
              <input ref={manualClipRef} type="file" accept="video/*" hidden onChange={handleManualClipUpload} />
            </section>
          )}

          {step === 6 && (
            <section className="step-panel active">
              <h2>Clip Timeline</h2>
              <div className="clip-timeline">
                {clips.map((c, i) => (
                  <div key={i} className="clip-card">
                    <video src={c.blobUrl} style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 6 }} />
                    <div className="clip-info">Clip {i + 1} · {c.duration.toFixed(1)}s</div>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => setClips((p) => p.filter((_, j) => j !== i))}>Del</button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => setStep(7)}>Continue to Export</button>
            </section>
          )}

          {step === 7 && (
            <section className="step-panel active">
              <h2>Export Full Video</h2>
              {!exportedUrl ? (
                <div className="export-area">
                  <button type="button" className="btn btn-primary btn-lg" onClick={exportVideo}>Export Full Video</button>
                  {exportPct > 0 && <div className="progress-bar" style={{ marginTop: 20 }}><div className="progress-fill" style={{ width: `${exportPct}%` }} /></div>}
                </div>
              ) : (
                <div className="done-screen">
                  <div className="done-icon">✓</div>
                  <h3>Done!</h3>
                  <div className="done-actions">
                    <a className="btn btn-primary" href={exportedUrl} download={`MangaFight_${Date.now()}.mp4`}>Download Video</a>
                  </div>
                  <video src={exportedUrl} controls className="final-preview" />
                </div>
              )}
            </section>
          )}
        </main>

        <aside className="sidebar sidebar-right">
          {showGeminiPanel && step >= 3 && step <= 5 && (
            <div className="gemini-webview-container">
              <h2>Gemini Panel</h2>
              <div className="gemini-panel hint-card" style={{ height: 320, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
                <p>Google blocks embedding Gemini in browsers. Use the button below to open Gemini in a new tab.</p>
                <button type="button" className="btn btn-primary btn-block" onClick={openGemini}>Open Gemini</button>
                <p className="sub" style={{ fontSize: 12 }}>1. Sign in · 2. + → Create image · 3. Upload panel · 4. Paste prompt · 5. Download output</p>
              </div>
            </div>
          )}
          <h2>Status</h2>
          <div className="status-log">
            {statusLog.map((s, i) => <p key={i} className={`status-item ${s.type}`}>{s.msg}</p>)}
          </div>
          {genStatus && (
            <div className="generation-status">
              <div className="spinner" />
              <p>{genStatus}</p>
            </div>
          )}
        </aside>
      </div>

      {showSettings && (
        <div className="modal">
          <div className="modal-backdrop" onClick={() => setShowSettings(false)} />
          <div className="modal-content">
            <div className="modal-header"><h2>Settings</h2><button type="button" className="btn btn-icon" onClick={() => setShowSettings(false)}>✕</button></div>
            <div className="modal-body">
              <div className="form-group"><label>Gemini API Key</label><input type="password" value={settings.apiKey} onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })} placeholder="For API image generation" /></div>
              <div className="form-group"><label>Theme</label>
                <select value={settings.theme} onChange={(e) => setSettings({ ...settings, theme: e.target.value })}>
                  <option value="solo-leveling">Solo Leveling</option>
                  <option value="naruto">Naruto</option>
                  <option value="demon-slayer">Demon Slayer</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="form-group"><label>General Prompt Override</label><textarea rows={4} value={settings.customGeneralPrompt} onChange={(e) => setSettings({ ...settings, customGeneralPrompt: e.target.value })} /></div>
            </div>
            <div className="modal-footer"><button type="button" className="btn btn-primary" onClick={saveSettings}>Save</button></div>
          </div>
        </div>
      )}

      {showLogin && (
        <div className="modal">
          <div className="modal-backdrop" onClick={() => setShowLogin(false)} />
          <div className="modal-content">
            <div className="modal-header"><h2>Gemini Login</h2><button type="button" className="btn btn-icon" onClick={() => setShowLogin(false)}>✕</button></div>
            <div className="modal-body">
              <p>Sign in to Gemini in a new browser tab to generate images and videos.</p>
              <button type="button" className="btn btn-primary btn-block" onClick={openGemini}>Open Gemini</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
