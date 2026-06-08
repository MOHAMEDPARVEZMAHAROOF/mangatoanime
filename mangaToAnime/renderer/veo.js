/**
 * Veo UI Automation — video generation inside the <webview>
 */
const VeoBrowser = (() => {
  function getWebview() {
    return document.getElementById('gemini-webview');
  }

  async function execInWebview(code) {
    const wv = getWebview();
    if (!wv) throw new Error('Gemini webview not found');
    return wv.executeJavaScript(code);
  }

  async function buildPrompt(keyframe, action, cameraMove) {
    const description = keyframe.description ||
      'Anime character in cinematic combat scene with dramatic lighting and shadow energy';
    return window.mangaAPI.buildVideoPrompt({ description, action, cameraMove });
  }

  async function generateClip(keyframe, prompt, clipIndex, total, onStatus) {
    try {
      const wv = getWebview();
      const imageBase64 = await window.mangaAPI.readFileBase64(keyframe.path);

      if (onStatus) onStatus({ message: `Opening new chat for clip ${clipIndex + 1}...`, progress: 5 });

      wv.src = 'https://gemini.google.com/app';
      await new Promise((r) => wv.addEventListener('dom-ready', r, { once: true }));
      await new Promise((r) => setTimeout(r, 2500));

      if (onStatus) onStatus({ message: 'Selecting video mode...', progress: 15 });

      await execInWebview(`
        (async function() {
          function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
          function queryAllDeep(root, selector) {
            const results = [];
            function walk(node) {
              if (!node) return;
              if (node.querySelectorAll) {
                node.querySelectorAll(selector).forEach(el => results.push(el));
                node.querySelectorAll('*').forEach(el => { if (el.shadowRoot) walk(el.shadowRoot); });
              }
            }
            walk(document);
            return results;
          }
          const items = queryAllDeep(document, 'button, [role="menuitem"], span, a');
          for (const item of items) {
            const t = (item.textContent || '').toLowerCase();
            if (t.includes('video') || t.includes('veo')) { item.click(); await sleep(1500); break; }
          }
        })()
      `);

      if (onStatus) onStatus({ message: 'Uploading keyframe reference...', progress: 30 });
      await execInWebview(`
        (async function() {
          function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
          const base64 = ${JSON.stringify(imageBase64)};
          const byteChars = atob(base64);
          const bytes = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
          const file = new File([bytes], 'keyframe.png', { type: 'image/png' });
          const inputs = document.querySelectorAll('input[type="file"]');
          if (inputs.length) {
            const dt = new DataTransfer();
            dt.items.add(file);
            inputs[inputs.length - 1].files = dt.files;
            inputs[inputs.length - 1].dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true };
          }
          const attach = Array.from(document.querySelectorAll('button')).find(b =>
            (b.getAttribute('aria-label') || '').toLowerCase().includes('attach'));
          if (attach) {
            attach.click();
            await sleep(800);
            const ins = document.querySelectorAll('input[type="file"]');
            if (ins.length) {
              const dt = new DataTransfer();
              dt.items.add(file);
              ins[ins.length - 1].files = dt.files;
              ins[ins.length - 1].dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true };
            }
          }
          return { success: false };
        })()
      `);

      if (onStatus) onStatus({ message: 'Submitting video prompt...', progress: 45 });

      await execInWebview(`
        (async function() {
          const prompt = ${JSON.stringify(prompt)};
          const fields = document.querySelectorAll('[contenteditable="true"], textarea');
          for (const f of fields) {
            if (f.tagName === 'TEXTAREA') { f.value = prompt; f.dispatchEvent(new Event('input', { bubbles: true })); }
            else { f.textContent = prompt; f.dispatchEvent(new InputEvent('input', { bubbles: true })); }
            break;
          }
          const send = Array.from(document.querySelectorAll('button')).find(b =>
            (b.getAttribute('aria-label') || '').toLowerCase().includes('send') && !b.disabled);
          if (send) send.click();
        })()
      `);

      if (onStatus) onStatus({ message: `Generating clip ${clipIndex + 1} of ${total}...`, progress: 55 });

      const downloadPromise = window.mangaAPI.waitForDownload(300000);

      const videoReady = await execInWebview(`
        (async function() {
          function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
          const start = Date.now();
          while (Date.now() - start < 300000) {
            const videos = Array.from(document.querySelectorAll('video')).filter(v => v.src && v.readyState >= 2);
            if (videos.length) {
              const v = videos[videos.length - 1];
              v.click();
              await sleep(1000);
              const dl = Array.from(document.querySelectorAll('a[download], button')).find(el => {
                const t = (el.textContent || '').toLowerCase();
                const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                return (el.tagName === 'A' && el.hasAttribute('download')) || t.includes('download') || aria.includes('download');
              });
              if (dl) { dl.click(); return { success: true }; }
              return { success: true, fetchSrc: v.src };
            }
            window.scrollTo(0, document.body.scrollHeight);
            await sleep(2000);
          }
          return { success: false, error: 'Video generation timed out' };
        })()
      `);

      if (!videoReady.success) {
        return { success: false, error: videoReady.error || 'Video not ready' };
      }

      let downloadPath;
      try {
        const dl = await downloadPromise;
        downloadPath = dl.path;
      } catch {
        if (videoReady.fetchSrc) {
          downloadPath = null;
        }
      }

      if (!downloadPath) {
        return { success: false, error: 'Could not download video clip' };
      }

      const savedPath = await window.mangaAPI.saveClip({ clipIndex, sourcePath: downloadPath });

      let seedPath = null;
      try {
        seedPath = await window.mangaAPI.extractSeedFrame({ clipPath: savedPath, clipIndex });
      } catch {
        // optional
      }

      const duration = await window.mangaAPI.getVideoDuration(savedPath);
      let thumbnail = null;
      try {
        thumbnail = await window.mangaAPI.generateThumbnail(savedPath);
      } catch {
        // optional
      }

      if (onStatus) onStatus({ message: 'Clip saved!', progress: 100 });

      return {
        success: true,
        path: savedPath,
        seedPath,
        duration,
        thumbnail,
        clipIndex,
        prompt,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function generateClipChain(keyframes, prompts, onProgress, onClipComplete) {
    const clips = [];
    let referenceImage = keyframes[0]?.path;

    for (let i = 0; i < keyframes.length; i++) {
      const keyframe = { ...keyframes[i], path: referenceImage || keyframes[i].path };
      const prompt = prompts[i];

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: keyframes.length,
          message: `Generating clip ${i + 1} of ${keyframes.length}...`,
        });
      }

      const result = await generateClip(keyframe, prompt, i, keyframes.length, (s) => {
        if (onProgress) onProgress({ ...s, current: i + 1, total: keyframes.length });
      });

      if (!result.success) {
        return { success: false, error: result.error, clips, failedIndex: i };
      }

      clips.push(result);
      if (result.seedPath) referenceImage = result.seedPath;
      if (onClipComplete) onClipComplete(result, i);
    }

    return { success: true, clips };
  }

  return { buildPrompt, generateClip, generateClipChain };
})();

// Backward-compatible alias used by app.js
const VeoHandler = VeoBrowser;
