/**
 * MangaToAnime — Main UI Application Logic
 */
(() => {
  const STEPS = [
    { id: 1, name: 'PDF Upload' },
    { id: 2, name: 'Panel Extraction' },
    { id: 3, name: 'Restyle to Anime' },
    { id: 4, name: 'Video Prompts' },
    { id: 5, name: 'Video Generation' },
    { id: 6, name: 'Clip Timeline' },
    { id: 7, name: 'Export' },
  ];

  const state = {
    currentStep: 1,
    pdfPath: null,
    thumbnails: [],
    selectedPages: [],
    extractedPanels: [],
    keyframes: [],
    videoPrompts: [],
    clips: [],
    settings: {},
    exportedPath: null,
    isLoggedIn: false,
    isAutomating: false,
  };

  let loginPollTimer = null;

  // DOM refs
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  async function init() {
    bindEvents();
    await loadSettings();
    setupStatusListeners();
    try {
      await GeminiBrowser.initWebview();
      logStatus('Gemini Live Interface ready');
      startLoginPolling();
    } catch (err) {
      logStatus(`Webview init: ${err.message}`, 'error');
    }
    logStatus('MangaToAnime ready');
  }

  function startLoginPolling() {
    if (loginPollTimer) clearInterval(loginPollTimer);
    loginPollTimer = setInterval(async () => {
      if (state.currentStep < 3) return;
      try {
        const loggedIn = await GeminiBrowser.checkLogin();
        updateLoginUI(loggedIn);
      } catch {
        updateLoginUI(false);
      }
    }, 2500);
  }

  function updateLoginUI(loggedIn) {
    state.isLoggedIn = loggedIn;
    const statusEl = $('#login-status');
    const textEl = $('#login-status-text');
    const restyleBtn = $('#btn-start-restyle');
    const videoBtn = $('#btn-start-video');
    const toast = $('#login-toast');

    if (loggedIn) {
      statusEl?.classList.remove('not-logged-in');
      statusEl?.classList.add('logged-in');
      if (textEl) textEl.textContent = 'Logged In';
      if (restyleBtn && state.currentStep === 3 && !state.isAutomating) restyleBtn.disabled = false;
      if (videoBtn && state.currentStep === 5 && !state.isAutomating) videoBtn.disabled = false;
      toast?.classList.add('hidden');
    } else {
      statusEl?.classList.add('not-logged-in');
      statusEl?.classList.remove('logged-in');
      if (textEl) textEl.textContent = 'Please Log In';
      if (restyleBtn) restyleBtn.disabled = true;
      if (videoBtn) videoBtn.disabled = true;
      if (toast && (state.currentStep === 3 || state.currentStep === 5)) {
        toast.classList.remove('hidden');
      }
    }
  }

  function bindEvents() {
    const dropZone = $('#drop-zone');
    dropZone.addEventListener('click', () => browsePdf());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith('.pdf')) {
        const filePath = window.getPathForFile(file);
        if (filePath) {
          await handlePdfFile(filePath);
        } else {
          const buffer = await file.arrayBuffer();
          const numPages = await PdfHandler.loadPdf(file.name, buffer);
          logStatus(`Loaded PDF with ${numPages} pages (from drop)`);
          await renderThumbnailsFromLoadedPdf();
        }
      }
    });

    $('#btn-process-panels').addEventListener('click', startExtraction);
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-close-settings').addEventListener('click', closeSettings);
    $('#btn-save-settings').addEventListener('click', saveSettings);
    $$('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', () => {
        if (backdrop.dataset.close === 'settings') closeSettings();
        if (backdrop.dataset.close === 'login') closeLogin();
      });
    });

    $('#btn-gemini-login').addEventListener('click', openLogin);
    $('#btn-top-bypass').addEventListener('click', () => doGeminiLogin(true));
    $('#btn-close-login').addEventListener('click', closeLogin);
    $('#btn-open-gemini-login').addEventListener('click', () => {
      closeLogin();
      GeminiBrowser.focusGeminiPanel();
      logStatus('Sign in inside the Gemini Live Interface panel');
    });
    $('#btn-bypass-login').addEventListener('click', () => doGeminiLogin(true));
    $('#btn-start-restyle').addEventListener('click', startRestylingAutomation);
    $('#btn-start-video').addEventListener('click', startVideoAutomation);

    $('#btn-export').addEventListener('click', startExport);
    $('#btn-open-video').addEventListener('click', () => {
      if (state.exportedPath) window.mangaAPI.openPath(state.exportedPath);
    });
    $('#btn-show-folder').addEventListener('click', () => {
      if (state.exportedPath) window.mangaAPI.showItemInFolder(state.exportedPath);
    });

    $('#setting-theme').addEventListener('change', applyThemePreview);
    $('#setting-bypass-login').addEventListener('change', toggleCookieGroup);
  }

  function setupStatusListeners() {
    window.mangaAPI.onGenerationStatus((data) => {
      logStatus(data.message);
    });
  }

  async function loadSettings() {
    state.settings = await window.mangaAPI.getSettings();
    applyTheme(state.settings.theme, state.settings.customColor);
    populateSettingsForm();
  }

  function applyTheme(theme, customColor) {
    document.body.classList.remove('theme-naruto', 'theme-demon-slayer');
    if (theme === 'naruto') document.body.classList.add('theme-naruto');
    else if (theme === 'demon-slayer') document.body.classList.add('theme-demon-slayer');
    else if (theme === 'custom' && customColor) {
      document.documentElement.style.setProperty('--accent', customColor);
    }
  }

  function applyThemePreview() {
    const theme = $('#setting-theme').value;
    const customColor = $('#setting-custom-color').value;
    applyTheme(theme, customColor);
  }

  function populateSettingsForm() {
    const s = state.settings;
    $('#setting-api-key').value = s.apiKey || '';
    $('#setting-theme').value = s.theme || 'solo-leveling';
    $('#setting-custom-color').value = s.customColor || '#7B5CF0';
    $('#setting-series').value = s.series || 'solo-leveling';
    $('#setting-clip-duration').value = String(s.clipDuration || 8);
    $('#setting-resolution').value = s.resolution || '1080p';
    $('#setting-bypass-login').checked = s.bypassLogin || false;
    $('#setting-gemini-cookie').value = s.geminiCookie || '';
    $('#setting-general-prompt').value = s.customGeneralPrompt || '';
    toggleCookieGroup();
  }

  function toggleCookieGroup() {
    const bypass = $('#setting-bypass-login').checked;
    $('#cookie-group').style.display = bypass ? 'block' : 'none';
  }

  function openSettings() {
    populateSettingsForm();
    $('#settings-modal').classList.remove('hidden');
  }

  function closeSettings() {
    $('#settings-modal').classList.add('hidden');
  }

  function openLogin() {
    $('#login-modal').classList.remove('hidden');
  }

  function closeLogin() {
    $('#login-modal').classList.add('hidden');
  }

  async function doGeminiLogin(bypass) {
    closeLogin();
    if (state.currentStep < 3) goToStep(3);
    const settings = await window.mangaAPI.getSettings();
    try {
      if (bypass || settings.bypassLogin) {
        if (!settings.geminiCookie) {
          openSettings();
          logStatus('Paste cookie in Settings first', 'error');
          return;
        }
        await GeminiBrowser.loginWithCookie(settings.geminiCookie);
        logStatus('Cookie injected — reloading Gemini', 'success');
        setTimeout(() => GeminiBrowser.checkLogin().then(updateLoginUI), 3000);
      } else {
        GeminiBrowser.focusGeminiPanel();
        logStatus('Sign in inside the Gemini Live Interface', 'success');
      }
    } catch (err) {
      logStatus(`Login error: ${err.message}`, 'error');
    }
  }

  async function saveSettings() {
    const settings = {
      apiKey: $('#setting-api-key').value,
      theme: $('#setting-theme').value,
      customColor: $('#setting-custom-color').value,
      series: $('#setting-series').value,
      clipDuration: parseInt($('#setting-clip-duration').value, 10),
      resolution: $('#setting-resolution').value,
      bypassLogin: $('#setting-bypass-login').checked,
      geminiCookie: $('#setting-gemini-cookie').value,
      customGeneralPrompt: $('#setting-general-prompt').value,
    };
    await window.mangaAPI.saveSettings(settings);
    state.settings = settings;
    applyTheme(settings.theme, settings.customColor);
    closeSettings();
    logStatus('Settings saved', 'success');
  }

  async function browsePdf() {
    const filePath = await window.mangaAPI.selectPdf();
    if (filePath) await handlePdfFile(filePath);
  }

  async function renderThumbnailsFromLoadedPdf() {
    $('#drop-zone').classList.add('hidden');
    const grid = $('#pdf-grid');
    grid.classList.remove('hidden');
    grid.innerHTML = '';

    const thumbnails = await PdfHandler.renderAllThumbnails((p) => {
      logStatus(`Rendering previews... ${Math.round(p * 100)}%`);
    });

    state.thumbnails = thumbnails;

    thumbnails.forEach((thumb) => {
      const el = document.createElement('div');
      el.className = 'pdf-thumb';
      el.dataset.pageIndex = thumb.pageIndex;
      el.innerHTML = `
        <img src="${thumb.dataUrl}" alt="Page ${thumb.pageNum}" />
        <span class="page-num">${thumb.pageNum}</span>
      `;
      el.addEventListener('click', () => togglePageSelection(thumb, el));
      grid.appendChild(el);
    });
  }

  async function handlePdfFile(filePath) {
    try {
      logStatus('Loading PDF...');
      state.pdfPath = filePath;
      const buffer = await window.mangaAPI.readFileBuffer(filePath);
      const numPages = await PdfHandler.loadPdf(filePath, buffer);
      logStatus(`Loaded PDF with ${numPages} pages`);
      await renderThumbnailsFromLoadedPdf();
    } catch (err) {
      logStatus(`Error loading PDF: ${err.message}`, 'error');
    }
  }

  function togglePageSelection(thumb, el) {
    const idx = state.selectedPages.findIndex((p) => p.pageIndex === thumb.pageIndex);

    if (idx >= 0) {
      state.selectedPages.splice(idx, 1);
      el.classList.remove('selected');
    } else {
      state.selectedPages.push(thumb);
      state.selectedPages.sort((a, b) => a.pageIndex - b.pageIndex);
      el.classList.add('selected');
    }

    updatePanelQueue();
    $('#btn-process-panels').disabled = state.selectedPages.length === 0;
  }

  function updatePanelQueue() {
    const queue = $('#panel-queue');
    if (!state.selectedPages.length) {
      queue.innerHTML = '<p class="empty-state">No panels selected</p>';
      return;
    }

    $('#queue-badge').textContent = String(state.selectedPages.length);

    queue.innerHTML = state.selectedPages
      .map(
        (p) => `
      <div class="queue-item">
        <img src="${p.dataUrl}" alt="Panel" />
        <div>
          <div>Page ${p.pageNum}</div>
          <div class="status-ready">${state.extractedPanels.some((e) => e.pageIndex === p.pageIndex) ? 'Ready' : 'Selected'}</div>
        </div>
      </div>
    `
      )
      .join('');
  }

  function goToStep(step) {
    state.currentStep = step;
    const stepInfo = STEPS[step - 1];
    $('#step-label').textContent = `Step ${step}/7`;
    $('#step-name').textContent = stepInfo.name;

    $$('.step-panel').forEach((panel) => panel.classList.remove('active'));
    $(`#step-${step}`).classList.add('active');

    if (step >= 6) {
      $('#timeline-footer').classList.remove('hidden');
      renderTimelineFooter();
    }

    if (step === 3 || step === 5) {
      GeminiBrowser.positionGeminiDock(step);
      setTimeout(() => GeminiBrowser.checkLogin().then(updateLoginUI).catch(() => updateLoginUI(false)), 500);
    }

    $('#login-toast').classList.toggle('hidden', step < 3 || state.isLoggedIn);
  }

  async function startExtraction() {
    if (!state.selectedPages.length) return;

    goToStep(2);
    const progress = $('#extract-progress');
    const status = $('#extract-status');

    try {
      const pageIndices = state.selectedPages.map((p) => p.pageIndex);
      state.extractedPanels = await PdfHandler.extractPages(pageIndices, (pct, current, total) => {
        progress.style.width = `${pct * 100}%`;
        status.textContent = `Extracting panel ${current} of ${total}...`;
      });

      status.textContent = 'Extraction complete!';
      logStatus(`Starting extraction of ${state.extractedPanels.length} panels at 300 DPI...`, 'success');
      state.extractedPanels.forEach((p, i) => {
        logStatus(`Extracted page ${p.pageNum} (${i + 1}/${state.extractedPanels.length})`);
      });
      logStatus(`Extraction complete. ${state.extractedPanels.length} panels saved.`, 'success');
      updatePanelQueue();

      goToStep(3);
      resetAutomationUI();
      logStatus('Log in to Gemini, then click Start Restyling Automation');
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      logStatus(`Extraction failed: ${err.message}`, 'error');
    }
  }

  function resetAutomationUI() {
    $('#auto-progress-text').textContent = `Processing panel 0 of ${state.extractedPanels.length}`;
    $('#auto-progress').style.width = '0%';
    $('#auto-pct').textContent = '0%';
    $('#automation-idle').classList.remove('hidden');
    $('#btn-start-restyle').disabled = !state.isLoggedIn;
  }

  function updateAutomationProgress(current, total, pct, message) {
    $('#auto-progress-text').textContent = message || `Processing panel ${current} of ${total}`;
    $('#auto-progress').style.width = `${pct}%`;
    $('#auto-pct').textContent = `${Math.round(pct)}%`;
  }

  async function startRestylingAutomation() {
    if (!state.isLoggedIn) {
      logStatus('Please log in to Gemini first', 'error');
      $('#login-toast').classList.remove('hidden');
      return;
    }
    if (!state.extractedPanels.length) {
      logStatus('No panels to process', 'error');
      return;
    }

    state.isAutomating = true;
    $('#btn-start-restyle').disabled = true;
    $('#automation-idle').classList.add('hidden');
    await startKeyframeGeneration();
    state.isAutomating = false;
    $('#btn-start-restyle').disabled = !state.isLoggedIn;
  }

  async function startKeyframeGeneration() {
    const list = $('#keyframe-list');
    list.innerHTML = '';
    state.keyframes = [];

    const total = state.extractedPanels.length;

    for (let i = 0; i < total; i++) {
      const panel = state.extractedPanels[i];
      const card = createKeyframeCard(panel, i, null, 'generating');
      list.appendChild(card);

      try {
        updateAutomationProgress(i + 1, total, ((i) / total) * 100, `Processing panel ${i + 1} of ${total}...`);
        logStatus(`Automating Gemini for panel ${i + 1}...`);

        const result = await GeminiBrowser.generateKeyframe(panel, i, total, (status) => {
          if (status?.message) logStatus(status.message);
          if (status?.progress != null) {
            updateAutomationProgress(i + 1, total, status.progress, status.message);
          }
        });

        if (result.success) {
          const keyframe = {
            panel,
            path: result.path,
            prompt: result.prompt,
            approved: false,
            index: i,
          };
          state.keyframes.push(keyframe);
          updateKeyframeCard(card, panel, keyframe);
          logStatus(`Keyframe ${i + 1} generated`, 'success');
        } else {
          updateKeyframeCardError(card, panel, result.error, i);
          logStatus(`Keyframe ${i + 1} failed: ${result.error}`, 'error');
        }
      } catch (err) {
        updateKeyframeCardError(card, panel, err.message, i);
        logStatus(`Keyframe ${i + 1} error: ${err.message}`, 'error');
      }
    }

    updateAutomationProgress(total, total, 100, 'Restyling complete!');
    logStatus('All panels processed. Approve keyframes below.', 'success');
  }

  async function startVideoAutomation() {
    if (!state.isLoggedIn) {
      logStatus('Please log in to Gemini first', 'error');
      return;
    }
    state.isAutomating = true;
    $('#btn-start-video').disabled = true;
    await startVideoGeneration();
    state.isAutomating = false;
    $('#btn-start-video').disabled = !state.isLoggedIn;
  }

  function createKeyframeCard(panel, index, keyframe, status) {
    const card = document.createElement('div');
    card.className = 'keyframe-card';
    card.dataset.index = index;

    if (status === 'generating') {
      card.innerHTML = `
        <h3>Panel ${index + 1}</h3>
        <div class="keyframe-compare">
          <figure><img src="${panel.dataUrl}" alt="Before" /><figcaption>Before (Manga)</figcaption></figure>
          <figure><div class="spinner" style="margin: 40px auto"></div><figcaption>Generating...</figcaption></figure>
        </div>
      `;
    }

    return card;
  }

  function updateKeyframeCard(card, panel, keyframe) {
    const imgSrc = `file://${keyframe.path}`;
    card.innerHTML = `
      <h3>Panel ${keyframe.index + 1}</h3>
      <div class="keyframe-compare">
        <figure><img src="${panel.dataUrl}" alt="Before" /><figcaption>Before (Manga)</figcaption></figure>
        <figure><img src="${imgSrc}" alt="After" /><figcaption>After (Anime)</figcaption></figure>
      </div>
      <div class="keyframe-actions">
        <button class="btn btn-ghost btn-sm btn-regenerate">Regenerate</button>
        <button class="btn btn-primary btn-sm btn-approve">Approve</button>
      </div>
    `;

    card.querySelector('.btn-regenerate').addEventListener('click', () => regenerateKeyframe(keyframe.index, card));
    card.querySelector('.btn-approve').addEventListener('click', () => approveKeyframe(keyframe.index, card));
  }

  function updateKeyframeCardError(card, panel, error, index) {
    card.innerHTML = `
      <h3>Panel ${index + 1}</h3>
      <div class="keyframe-compare">
        <figure><img src="${panel.dataUrl}" alt="Before" /><figcaption>Before (Manga)</figcaption></figure>
        <figure><p style="color: var(--error); padding: 20px;">${error}</p></figure>
      </div>
      <div class="keyframe-actions">
        <button class="btn btn-primary btn-sm btn-retry">Retry</button>
      </div>
    `;
    card.querySelector('.btn-retry').addEventListener('click', async () => {
      await regenerateKeyframe(index, card);
    });
  }

  async function regenerateKeyframe(index, card) {
    const panel = state.extractedPanels[index];
    card.querySelector('.keyframe-compare').innerHTML = `
      <figure><img src="${panel.dataUrl}" alt="Before" /></figure>
      <figure><div class="spinner" style="margin: 40px auto"></div><figcaption>Regenerating...</figcaption></figure>
    `;

    const result = await GeminiBrowser.generateKeyframe(panel, index, state.extractedPanels.length, (status) => {
      if (status?.message) logStatus(status.message);
    });

    if (result.success) {
      state.keyframes[index] = {
        ...state.keyframes[index],
        path: result.path,
        prompt: result.prompt,
        approved: false,
      };
      updateKeyframeCard(card, panel, state.keyframes[index]);
    } else {
      updateKeyframeCardError(card, panel, result.error, index);
    }
  }

  function approveKeyframe(index, card) {
    state.keyframes[index].approved = true;
    card.classList.add('approved');

    const allApproved = state.keyframes.length > 0 &&
      state.keyframes.every((k) => k && k.approved);

    if (allApproved) {
      logStatus('All keyframes approved', 'success');
      setTimeout(() => startPromptBuilder(), 500);
    }
  }

  async function startPromptBuilder() {
    goToStep(4);
    const builder = $('#prompt-builder');
    builder.innerHTML = '';
    state.videoPrompts = [];

    const presets = GeminiBrowser.getActionPresets();

    for (let i = 0; i < state.keyframes.length; i++) {
      const kf = state.keyframes[i];
      const description = await GeminiBrowser.describeKeyframe(kf.path);
      kf.description = description;

      const defaultPreset = presets['combat-strike'];
      const prompt = await VeoHandler.buildPrompt(kf, defaultPreset.action, defaultPreset.camera);

      const card = document.createElement('div');
      card.className = 'prompt-card';
      card.dataset.index = i;
      card.innerHTML = `
        <h3>Clip ${i + 1} Prompt</h3>
        <img src="file://${kf.path}" alt="Keyframe" />
        <div class="preset-buttons">
          ${Object.entries(presets)
            .map(
              ([key, val]) =>
                `<button class="preset-btn" data-preset="${key}">${key.replace(/-/g, ' ')}</button>`
            )
            .join('')}
        </div>
        <div class="form-group">
          <label>Action</label>
          <input type="text" class="input-action" value="${defaultPreset.action}" />
        </div>
        <div class="form-group">
          <label>Camera Move</label>
          <input type="text" class="input-camera" value="${defaultPreset.camera}" />
        </div>
        <div class="form-group">
          <label>Full Video Prompt</label>
          <textarea class="input-prompt" rows="4">${prompt}</textarea>
        </div>
      `;

      card.querySelectorAll('.preset-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const preset = presets[btn.dataset.preset];
          card.querySelector('.input-action').value = preset.action;
          card.querySelector('.input-camera').value = preset.camera;
          const newPrompt = await VeoHandler.buildPrompt(
            kf,
            preset.action,
            preset.camera
          );
          card.querySelector('.input-prompt').value = newPrompt;
          card.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });

      const updatePrompt = async () => {
        const action = card.querySelector('.input-action').value;
        const camera = card.querySelector('.input-camera').value;
        const newPrompt = await VeoHandler.buildPrompt(kf, action, camera);
        card.querySelector('.input-prompt').value = newPrompt;
      };

      card.querySelector('.input-action').addEventListener('input', updatePrompt);
      card.querySelector('.input-camera').addEventListener('input', updatePrompt);

      builder.appendChild(card);
      state.videoPrompts.push({ keyframe: kf, prompt });
    }

    const startBtn = document.createElement('button');
    startBtn.className = 'btn btn-primary btn-lg';
    startBtn.textContent = 'Continue to Video Generation';
    startBtn.addEventListener('click', () => {
      goToStep(5);
      GeminiBrowser.positionGeminiDock(5);
      logStatus('Log in to Gemini if needed, then click Start Video Automation');
    });
    builder.appendChild(startBtn);
  }

  async function startVideoGeneration() {
    const promptCards = $$('.prompt-card');
    const prompts = Array.from(promptCards).map((card) => card.querySelector('.input-prompt').value);

    const progress = $('#video-progress');
    const status = $('#video-status');

    state.clips = [];

    const result = await VeoHandler.generateClipChain(
      state.keyframes,
      prompts,
      (p) => {
        status.textContent = p.message;
        progress.style.width = `${(p.current / p.total) * 100}%`;
      },
      (clip) => {
        state.clips.push(clip);
      }
    );

    if (result.success) {
      state.clips = result.clips;
      status.textContent = 'All clips generated!';
      logStatus(`Generated ${state.clips.length} video clips`, 'success');
      setTimeout(() => showClipTimeline(), 800);
    } else {
      status.textContent = `Error at clip ${result.failedIndex + 1}: ${result.error}`;
      logStatus(result.error, 'error');

      if (result.clips.length) {
        state.clips = result.clips;
        showClipTimeline();
      }
    }

  }

  function showClipTimeline() {
    goToStep(6);
    renderClipTimeline();
  }

  function renderClipTimeline() {
    const timeline = $('#clip-timeline');
    timeline.innerHTML = '';

    state.clips.forEach((clip, i) => {
      const card = document.createElement('div');
      card.className = 'clip-card';
      card.draggable = true;
      card.dataset.index = i;

      const thumbSrc = clip.thumbnail ? `file://${clip.thumbnail}` : '';
      card.innerHTML = `
        ${thumbSrc ? `<img src="${thumbSrc}" alt="Clip ${i + 1}" />` : '<div style="height:90px;background:var(--bg);border-radius:6px"></div>'}
        <div class="clip-info">Clip ${i + 1} · ${(clip.duration || 0).toFixed(1)}s</div>
        <div class="clip-actions">
          <button class="btn btn-ghost btn-sm btn-play">Play</button>
          <button class="btn btn-ghost btn-sm btn-regen-clip">Redo</button>
          <button class="btn btn-danger btn-sm btn-delete-clip">Del</button>
        </div>
      `;

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', i);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (e) => e.preventDefault());
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const to = i;
        if (from !== to) reorderClips(from, to);
      });

      card.querySelector('.btn-play').addEventListener('click', () => playClip(clip));
      card.querySelector('.btn-delete-clip').addEventListener('click', () => deleteClip(i));
      card.querySelector('.btn-regen-clip').addEventListener('click', () => regenerateClip(i));

      timeline.appendChild(card);
    });

    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn btn-primary';
    exportBtn.textContent = 'Continue to Export';
    exportBtn.style.marginTop = '20px';
    exportBtn.addEventListener('click', () => goToStep(7));
    timeline.appendChild(exportBtn);

    renderTimelineFooter();
  }

  function renderTimelineFooter() {
    const footer = $('#timeline-clips');
    if (!footer) return;
    footer.innerHTML = state.clips
      .map(
        (c, i) =>
          `<div class="clip-card" style="width:100px"><div class="clip-info">#${i + 1}</div></div>`
      )
      .join('');
  }

  function reorderClips(from, to) {
    const [clip] = state.clips.splice(from, 1);
    state.clips.splice(to, 0, clip);
    renderClipTimeline();
  }

  function playClip(clip) {
    const player = $('#clip-player');
    const video = $('#preview-video');
    player.classList.remove('hidden');
    video.src = `file://${clip.path}`;
    video.play();
  }

  async function deleteClip(index) {
    const clip = state.clips[index];
    if (clip.path) await window.mangaAPI.deleteFile(clip.path);
    state.clips.splice(index, 1);
    renderClipTimeline();
  }

  async function regenerateClip(index) {
    const kf = state.keyframes[index];
    const prompt = state.videoPrompts[index]?.prompt ||
      $(`.prompt-card[data-index="${index}"] .input-prompt`)?.value;

    logStatus(`Regenerating clip ${index + 1}...`);

    const result = await VeoHandler.generateClip(kf, prompt, index, state.keyframes.length);

    if (result.success) {
      if (state.clips[index]?.path) {
        await window.mangaAPI.deleteFile(state.clips[index].path);
      }
      state.clips[index] = result;
      renderClipTimeline();
      logStatus(`Clip ${index + 1} regenerated`, 'success');
    } else {
      logStatus(`Regeneration failed: ${result.error}`, 'error');
    }
  }

  async function startExport() {
    if (!state.clips.length) {
      logStatus('No clips to export', 'error');
      return;
    }

    $('#export-progress-area').classList.remove('hidden');
    $('#btn-export').disabled = true;

    try {
      const result = await FfmpegHandler.exportFullVideo(state.clips, (data) => {
        $('#export-progress').style.width = `${data.percent || 0}%`;
        $('#export-status').textContent = `Stitching... ${Math.round(data.percent || 0)}%`;
      });

      state.exportedPath = result.path;
      $('#export-area').classList.add('hidden');
      $('#done-screen').classList.remove('hidden');
      $('#done-path').textContent = result.path;
      $('#final-preview').src = `file://${result.path}`;

      logStatus('Export complete!', 'success');
    } catch (err) {
      $('#export-status').textContent = `Export failed: ${err.message}`;
      logStatus(`Export failed: ${err.message}`, 'error');
      $('#btn-export').disabled = false;
    }
  }

  function logStatus(message, type = '') {
    const log = $('#status-log');
    const item = document.createElement('p');
    item.className = `status-item ${type}`;
    item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    log.prepend(item);

    while (log.children.length > 50) {
      log.removeChild(log.lastChild);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
