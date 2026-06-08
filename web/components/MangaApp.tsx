'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import GeminiLivePanel from '@/components/GeminiLivePanel';
import { extractPageHighRes, loadPdf, renderAllThumbnails } from '@/lib/pdf';
import { ACTION_PRESETS, buildVideoPrompt, optimizePrompt } from '@/lib/prompts';

const STEPS = [
  'PDF Upload',
  'Panel Extraction',
  'Restyle to Anime',
  'Video Prompts',
  'Video Generation',
  'Clip Timeline',
  'Export',
];

type Thumb = { pageIndex: number; pageNum: number; dataUrl: string };
type Panel = Thumb & { dataUrl: string };
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
  clipIndex: number;
};

type Settings = {
  apiKey: string;
  theme: string;
  customColor: string;
  clipDuration: number;
  customGeneralPrompt: string;
};

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  theme: 'solo-leveling',
  customColor: '#7B5CF0',
  clipDuration: 8,
  customGeneralPrompt: '',
};

async function getImageDimensions(dataUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
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
    { msg: 'MangaToAnime ready on Vercel — open in browser, no install needed' },
  ]);
  const [geminiLoggedIn, setGeminiLoggedIn] = useState(false);
  const [automating, setAutomating] = useState(false);
  const [autoPct, setAutoPct] = useState(0);
  const [autoText, setAutoText] = useState('Processing panel 0 of 0');
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [activePanel, setActivePanel] = useState(0);
  const [genStatus, setGenStatus] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [extractPct, setExtractPct] = useState(0);
  const [exportedUrl, setExportedUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [showPdfGrid, setShowPdfGrid] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const manualKeyframeRef = useRef<HTMLInputElement>(null);
  const manualClipRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('mangatoanime-settings');
    if (saved) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
  }, []);

  const log = useCallback((msg: string, type = '') => {
    setStatusLog((prev) => [{ msg: `[${new Date().toLocaleTimeString()}] ${msg}`, type }, ...prev].slice(0, 60));
  }, []);

  const saveSettings = () => {
    localStorage.setItem('mangatoanime-settings', JSON.stringify(settings));
    setShowSettings(false);
    log('Settings saved', 'success');
  };

  const handlePdf = async (file: File) => {
    log('Loading PDF...');
    const buf = await file.arrayBuffer();
    const numPages = await loadPdf(buf);
    log(`Loaded PDF with ${numPages} pages`);
    const thumbs = await renderAllThumbnails();
    setThumbnails(thumbs);
    setShowPdfGrid(true);
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
    log(`Starting extraction of ${selectedPages.length} panels at 300 DPI...`);
    for (let i = 0; i < selectedPages.length; i++) {
      const p = selectedPages[i];
      const dataUrl = await extractPageHighRes(p.pageIndex);
      panels.push({ ...p, dataUrl });
      setExtractPct(((i + 1) / selectedPages.length) * 100);
      log(`Extracted page ${p.pageNum} (${i + 1}/${selectedPages.length})`);
    }
    setExtractedPanels(panels);
    log(`Extraction complete. ${panels.length} panels saved.`, 'success');
    setKeyframes(panels.map((p, i) => ({ panel: p, path: '', approved: false, index: i })));
    setStep(3);
    setAutoText(`Processing panel 0 of ${panels.length}`);
    log('Open Gemini popup → sign in → click Start Restyling Automation');
  };

  const getPromptForPanel = async (panel: Panel) => {
    const dims = await getImageDimensions(panel.dataUrl);
    return optimizePrompt({
      width: dims.width,
      height: dims.height,
      theme: settings.theme,
      customColor: settings.customColor,
      customGeneralPrompt: settings.customGeneralPrompt,
    });
  };

  const copyCurrentPrompt = async () => {
    const panel = extractedPanels[activePanel];
    if (!panel) return;
    const prompt = await getPromptForPanel(panel);
    setCurrentPrompt(prompt);
    await navigator.clipboard.writeText(prompt);
    log(`Prompt copied for panel ${activePanel + 1}`, 'success');
  };

  const generateKeyframeApi = async (panel: Panel, index: number) => {
    const dims = await getImageDimensions(panel.dataUrl);
    const prompt = await getPromptForPanel(panel);
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

  const startRestylingAutomation = async () => {
    if (!geminiLoggedIn && !settings.apiKey) {
      log('Sign in to Gemini or add API key in Settings', 'error');
      return;
    }
    setAutomating(true);
    const total = extractedPanels.length;

    for (let i = 0; i < total; i++) {
      const panel = extractedPanels[i];
      setActivePanel(i);
      setAutoText(`Processing panel ${i + 1} of ${total}`);
      setAutoPct(((i + 1) / total) * 100);

      if (settings.apiKey) {
        log(`API: generating keyframe ${i + 1}...`);
        const result = await generateKeyframeApi(panel, i);
        if (result.success && result.imageBase64) {
          setKeyframes((prev) => {
            const n = [...prev];
            n[i] = { ...n[i], path: result.imageBase64, prompt: result.prompt };
            return n;
          });
          log(`Keyframe ${i + 1} generated via API`, 'success');
        } else {
          log(result.error || 'API failed — use Gemini popup + Upload Result', 'error');
          const prompt = result.prompt || (await getPromptForPanel(panel));
          setCurrentPrompt(prompt);
          await navigator.clipboard.writeText(prompt);
          log(`Prompt copied — complete panel ${i + 1} in Gemini popup, then Upload Result`);
          break;
        }
      } else {
        const prompt = await getPromptForPanel(panel);
        setCurrentPrompt(prompt);
        await navigator.clipboard.writeText(prompt);
        log(`Panel ${i + 1}: prompt copied! Use Gemini popup → Create image → upload panel → paste → download → Upload Result`);
        break;
      }
    }
    setAutomating(false);
  };

  const handleKeyframeUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const path = reader.result as string;
      const idx = activePanel;
      setKeyframes((prev) => {
        const n = [...prev];
        n[idx] = { ...n[idx], path };
        return n;
      });
      log(`Keyframe ${idx + 1} uploaded`, 'success');
      if (idx + 1 < extractedPanels.length && !settings.apiKey) {
        setActivePanel(idx + 1);
        getPromptForPanel(extractedPanels[idx + 1]).then(async (p) => {
          setCurrentPrompt(p);
          await navigator.clipboard.writeText(p);
          setAutoText(`Processing panel ${idx + 2} of ${extractedPanels.length}`);
          log(`Next panel ${idx + 2}: prompt copied — continue in Gemini popup`);
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const approveKeyframe = (index: number) => {
    setKeyframes((prev) => {
      const n = [...prev];
      n[index] = { ...n[index], approved: true };
      if (n.every((k) => k.approved && k.path)) setTimeout(() => setStep(4), 400);
      return n;
    });
  };

  const exportVideo = async () => {
    if (!clips.length) return;
    setGenStatus('Stitching with FFmpeg...');
    try {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { fetchFile, toBlobURL } = await import('@ffmpeg/util');
      const ffmpeg = new FFmpeg();
      const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      for (let i = 0; i < clips.length; i++) {
        await ffmpeg.writeFile(`c${i}.mp4`, await fetchFile(clips[i].blobUrl));
      }
      await ffmpeg.writeFile('list.txt', clips.map((_, i) => `file 'c${i}.mp4'`).join('\n'));
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4']);
      const data = await ffmpeg.readFile('out.mp4');
      const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
      setExportedUrl(URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' })));
      setGenStatus('');
      log('Export complete!', 'success');
    } catch (err) {
      log(`Export failed: ${err instanceof Error ? err.message : 'error'}`, 'error');
      setGenStatus('');
    }
  };

  return (
    <div className="app">
      <div className="vercel-banner">
        Running on <strong>Vercel</strong> — use Gemini popup for image/video generation, or add API key in Settings for auto mode
      </div>

      <header className="top-bar">
        <div className="logo-area">
          <div className="logo" style={{ background: 'linear-gradient(135deg,#7B5CF0,#a78bfa)', width: 32, height: 32, borderRadius: 8 }} />
          <div>
            <h1>MangaToAnime</h1>
            <span style={{ fontSize: 11, color: '#7B5CF0' }}>Vercel Web App</span>
          </div>
        </div>
        <div className="step-indicator">
          <span className="step-label">Step {step}/7</span>
          <span className="step-name">{STEPS[step - 1]}</span>
        </div>
        <div className="top-actions">
          <div className={`login-status ${geminiLoggedIn ? 'logged-in' : 'not-logged-in'}`}>
            <span className="login-dot" />
            <span>{geminiLoggedIn ? 'Gemini Ready' : 'Sign in via popup'}</span>
          </div>
          <button type="button" className="btn btn-icon" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </header>

      {!geminiLoggedIn && step === 3 && (
        <div className="login-toast">⚠️ Open Gemini popup and click &quot;I&apos;m signed in&quot;</div>
      )}

      <div className="main-layout">
        <aside className="sidebar sidebar-left">
          <h2>Panel Queue <span className="badge">{selectedPages.length}</span></h2>
          <div className="queue-list">
            {selectedPages.length === 0 ? (
              <p className="empty-state">No panels selected</p>
            ) : (
              selectedPages.map((p) => (
                <div key={p.pageIndex} className="queue-item">
                  <img src={p.dataUrl} alt="" />
                  <div>
                    <div>Page {p.pageNum}</div>
                    <small style={{ color: '#22c55e' }}>
                      {extractedPanels.some((e) => e.pageIndex === p.pageIndex) ? 'Ready' : 'Selected'}
                    </small>
                  </div>
                </div>
              ))
            )}
          </div>
          <button type="button" className="btn btn-primary btn-block" disabled={!selectedPages.length} onClick={startExtraction}>
            🚀 Process Selected Panels
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
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.pdf')) handlePdf(f); }}
                >
                  <div className="drop-icon">📄</div>
                  <p>Drag & drop a manga PDF here</p>
                  <p className="sub">or click to browse</p>
                  <input ref={fileRef} type="file" accept=".pdf" hidden onChange={(e) => e.target.files?.[0] && handlePdf(e.target.files[0])} />
                </div>
              ) : (
                <div className="pdf-grid">
                  {thumbnails.map((t) => (
                    <div key={t.pageIndex} className={`pdf-thumb ${selectedPages.some((p) => p.pageIndex === t.pageIndex) ? 'selected' : ''}`} onClick={() => togglePage(t)}>
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
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${extractPct}%` }} /></div>
            </section>
          )}

          {step === 3 && (
            <section className="step-panel active">
              <h2>Step 3 — Restyle to Anime</h2>
              <div className="restyle-layout">
                <GeminiLivePanel
                  onLoginConfirm={() => { setGeminiLoggedIn(true); log('Gemini login confirmed', 'success'); }}
                  currentPrompt={currentPrompt}
                  onCopyPrompt={copyCurrentPrompt}
                />
                <div className="automation-panel">
                  <h3>Automation</h3>
                  <p className="auto-text">{autoText}</p>
                  <div className="progress-bar"><div className="progress-fill" style={{ width: `${autoPct}%` }} /></div>
                  <p className="auto-pct">{Math.round(autoPct)}%</p>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={automating || (!geminiLoggedIn && !settings.apiKey)}
                    onClick={startRestylingAutomation}
                  >
                    ▶ Start Restyling Automation
                  </button>
                  {!automating && (
                    <div className="automation-idle">
                      <div style={{ fontSize: 32 }}>🤖</div>
                      <p><strong>Awaiting Automation</strong></p>
                      <p>Sign in via Gemini popup, then click Start.</p>
                      {settings.apiKey && <p style={{ color: '#7B5CF0' }}>API key set — full auto mode enabled</p>}
                    </div>
                  )}
                  {extractedPanels[activePanel] && (
                    <div style={{ marginTop: 12 }}>
                      <p style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Current panel to upload in Gemini:</p>
                      <img src={extractedPanels[activePanel].dataUrl} alt="" style={{ width: '100%', borderRadius: 8 }} />
                      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => manualKeyframeRef.current?.click()}>
                        Upload Result
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="keyframe-list" style={{ marginTop: 20 }}>
                {keyframes.map((kf) => (
                  <div key={kf.index} className={`keyframe-card ${kf.approved ? 'approved' : ''}`}>
                    <div className="keyframe-compare">
                      <figure><img src={kf.panel.dataUrl} alt="" /><figcaption>Before</figcaption></figure>
                      <figure>{kf.path ? <img src={kf.path} alt="" /> : <div className="spinner" />}<figcaption>After</figcaption></figure>
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" disabled={!kf.path} onClick={() => approveKeyframe(kf.index)}>Approve</button>
                  </div>
                ))}
              </div>
              <input ref={manualKeyframeRef} type="file" accept="image/*" hidden onChange={handleKeyframeUpload} />
            </section>
          )}

          {step === 4 && (
            <section className="step-panel active">
              <h2>Video Prompt Builder</h2>
              {keyframes.map((kf, i) => {
                const preset = ACTION_PRESETS['combat-strike'];
                return (
                  <div key={i} className="prompt-card">
                    <h3>Clip {i + 1}</h3>
                    {kf.path && <img src={kf.path} alt="" style={{ maxWidth: 200 }} />}
                    <textarea className="input-prompt" rows={3} defaultValue={buildVideoPrompt('Anime combat scene', preset.action, preset.camera)} />
                  </div>
                );
              })}
              <button type="button" className="btn btn-primary btn-lg" onClick={() => setStep(5)}>Continue to Video Generation</button>
            </section>
          )}

          {step === 5 && (
            <section className="step-panel active">
              <h2>Video Generation</h2>
              <GeminiLivePanel onLoginConfirm={() => setGeminiLoggedIn(true)} onCopyPrompt={copyCurrentPrompt} />
              <p style={{ margin: '12px 0', color: '#888' }}>Generate videos in Gemini popup, then upload each clip.</p>
              <button type="button" className="btn btn-primary" onClick={() => manualClipRef.current?.click()}>Upload Clip</button>
              <button type="button" className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => setStep(6)}>Continue to Timeline</button>
              <input ref={manualClipRef} type="file" accept="video/*" hidden onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const url = URL.createObjectURL(file);
                const v = document.createElement('video');
                v.src = url;
                v.onloadedmetadata = () => {
                  setClips((p) => [...p, { path: file.name, blobUrl: url, duration: v.duration, clipIndex: p.length }]);
                  log(`Clip uploaded`, 'success');
                };
                e.target.value = '';
              }} />
            </section>
          )}

          {step === 6 && (
            <section className="step-panel active">
              <h2>Clip Timeline</h2>
              <div className="clip-timeline">
                {clips.map((c, i) => (
                  <div key={i} className="clip-card">
                    <video src={c.blobUrl} style={{ width: '100%', height: 90, objectFit: 'cover' }} />
                    <span>Clip {i + 1}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setStep(7)}>Export</button>
            </section>
          )}

          {step === 7 && (
            <section className="step-panel active">
              <h2>Export</h2>
              {!exportedUrl ? (
                <button type="button" className="btn btn-primary btn-lg" onClick={exportVideo}>Export Full Video</button>
              ) : (
                <div className="done-screen">
                  <a className="btn btn-primary" href={exportedUrl} download={`MangaFight_${Date.now()}.mp4`}>Download MP4</a>
                  <video src={exportedUrl} controls className="final-preview" />
                </div>
              )}
              {genStatus && <p>{genStatus}</p>}
            </section>
          )}
        </main>

        <aside className="sidebar sidebar-right">
          <h2>Activity Log</h2>
          <div className="status-log">
            {statusLog.map((s, i) => <p key={i} className={`status-item ${s.type}`}>{s.msg}</p>)}
          </div>
        </aside>
      </div>

      {showSettings && (
        <div className="modal">
          <div className="modal-backdrop" onClick={() => setShowSettings(false)} />
          <div className="modal-content">
            <div className="modal-header"><h2>Settings</h2><button type="button" className="btn btn-icon" onClick={() => setShowSettings(false)}>✕</button></div>
            <div className="modal-body">
              <div className="form-group">
                <label>Gemini API Key (optional — enables full auto on Vercel)</label>
                <input type="password" value={settings.apiKey} onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })} placeholder="Get key at aistudio.google.com" />
              </div>
              <div className="form-group">
                <label>General Prompt Override</label>
                <textarea rows={4} value={settings.customGeneralPrompt} onChange={(e) => setSettings({ ...settings, customGeneralPrompt: e.target.value })} />
              </div>
            </div>
            <div className="modal-footer"><button type="button" className="btn btn-primary" onClick={saveSettings}>Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
