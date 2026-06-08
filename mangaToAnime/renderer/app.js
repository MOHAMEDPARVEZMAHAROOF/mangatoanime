/**
 * MangaToAnime — Main UI Application Logic
 */
(() => {
  const STEPS = [
    { id: 1, name: 'PDF Upload' },
    { id: 2, name: 'Panel Extraction' },
    { id: 3, name: 'Anime Keyframes' },
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
  };

  // DOM refs
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function init() {
    bindEvents();
    loadSettings();
    setupStatusListeners();
    logStatus('MangaToAnime ready');
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
    $('.modal-backdrop')?.addEventListener('click', () => {
      closeSettings();
      closeLogin();
    });

    $('#btn-gemini-login').addEventListener('click', openLogin);
    $('#btn-close-login').addEventListener('click', closeLogin);
    $('#btn-open-gemini-login').addEventListener('click', () => doGeminiLogin(false));
    $('#btn-bypass-login').addEventListener('click', () => doGeminiLogin(true));

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
      showGenerationStatus(data.message, data.progress);
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
    const settings = await window.mangaAPI.getSettings();
    const result = await window.mangaAPI.geminiLogin({
      cookie: settings.geminiCookie,
      bypass: bypass || settings.bypassLogin,
    });
    logStatus(bypass ? 'Logged in via cookie bypass' : 'Opened Google sign-in', 'success');
    closeLogin();
    return result;
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

    queue.innerHTML = state.selectedPages
      .map(
        (p, i) => `
      <div class="queue-item">
        <img src="${p.dataUrl}" alt="Panel ${i + 1}" />
        <span>Page ${p.pageNum}</span>
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
      logStatus(`Extracted ${state.extractedPanels.length} panels`, 'success');

      await startKeyframeGeneration();
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      logStatus(`Extraction failed: ${err.message}`, 'error');
    }
  }

  async function startKeyframeGeneration() {
    goToStep(3);
    const list = $('#keyframe-list');
    list.innerHTML = '';
    state.keyframes = [];

    const total = state.extractedPanels.length;

    for (let i = 0; i < total; i++) {
      const panel = state.extractedPanels[i];
      const card = createKeyframeCard(panel, i, null, 'generating');
      list.appendChild(card);

      try {
        showGenerationStatus(`Generating keyframe ${i + 1} of ${total}...`);

        const result = await GeminiHandler.generateKeyframe(panel, i, total, true);

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

    hideGenerationStatus();
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

    const result = await GeminiHandler.generateKeyframe(panel, index, state.extractedPanels.length, true);

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

    const presets = GeminiHandler.getActionPresets();

    for (let i = 0; i < state.keyframes.length; i++) {
      const kf = state.keyframes[i];
      const description = await GeminiHandler.describeKeyframe(kf.path);
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
    startBtn.textContent = 'Start Video Generation';
    startBtn.addEventListener('click', startVideoGeneration);
    builder.appendChild(startBtn);
  }

  async function startVideoGeneration() {
    goToStep(5);

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

    hideGenerationStatus();
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

    showGenerationStatus(`Regenerating clip ${index + 1}...`);

    const result = await VeoHandler.generateClip(kf, prompt, index, state.keyframes.length);

    hideGenerationStatus();

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

  function showGenerationStatus(message, progress) {
    const el = $('#generation-status');
    el.classList.remove('hidden');
    $('#gen-status-text').textContent = message;
  }

  function hideGenerationStatus() {
    $('#generation-status').classList.add('hidden');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
