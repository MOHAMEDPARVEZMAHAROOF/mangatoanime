/**
 * Gemini UI Automation — runs inside the <webview> via executeJavaScript
 */
const GeminiBrowser = (() => {
  let imageModeActive = false;

  const ACTION_PRESETS = {
    'dramatic-pause': {
      action: 'Character holds a tense dramatic pause, energy building around them',
      camera: 'Slow push-in toward the character face',
    },
    'power-explosion': {
      action: 'Massive shadow energy explosion erupts outward with violent force',
      camera: 'Wide shot pulling back rapidly to reveal the full blast radius',
    },
    'combat-strike': {
      action: 'Lightning-fast combat strike connecting with devastating impact',
      camera: 'Dynamic side angle tracking the strike motion',
    },
    'dodge-movement': {
      action: 'Character evades with a fluid high-speed dodge, afterimage trailing',
      camera: 'Whip pan following the dodge trajectory',
    },
    'final-blow': {
      action: 'Devastating final blow lands with earth-shattering force',
      camera: 'Low angle dramatic shot emphasizing the impact power',
    },
    'victory-pose': {
      action: 'Character stands victorious as shadow energy dissipates around them',
      camera: 'Slow crane shot rising to reveal the victorious stance',
    },
  };

  const DOM_HELPERS = `
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function walkShadowRoots(root, fn) {
      const result = fn(root);
      if (result) return result;
      const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of all) {
        if (el.shadowRoot) {
          const found = walkShadowRoots(el.shadowRoot, fn);
          if (found) return found;
        }
      }
      return null;
    }

    function queryAllDeep(root, selector) {
      const results = [];
      function walk(node) {
        if (!node) return;
        if (node.querySelectorAll) {
          node.querySelectorAll(selector).forEach(el => results.push(el));
          node.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) walk(el.shadowRoot);
          });
        }
      }
      walk(root);
      return results;
    }

    function findByText(texts, root) {
      root = root || document;
      const targets = Array.isArray(texts) ? texts : [texts];
      const lower = targets.map(t => t.toLowerCase());
      const nodes = queryAllDeep(root, 'button, [role="menuitem"], [role="option"], a, span, div');
      for (const node of nodes) {
        const t = (node.textContent || '').trim().toLowerCase();
        const aria = (node.getAttribute('aria-label') || '').toLowerCase();
        for (const target of lower) {
          if (t.includes(target) || aria.includes(target)) return node;
        }
      }
      return null;
    }

    function findSendButton() {
      const selectors = [
        'button[aria-label*="Send"]',
        'button[send-button]',
        'button[data-test-id="send-button"]',
      ];
      for (const sel of selectors) {
        const found = walkShadowRoots(document, root => root.querySelector(sel));
        if (found) return found;
      }
      return findByText(['send message', 'send']);
    }

    async function waitForSendEnabled(timeout) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const btn = findSendButton();
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') return btn;
        await sleep(200);
      }
      return null;
    }

    async function findActiveEditor(timeout) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const editors = queryAllDeep(document, 'rich-textarea, [contenteditable="true"], textarea, .ql-editor');
        for (const editor of editors) {
          if (!editor.isConnected) continue;
          const editable = editor.getAttribute('contenteditable') === 'true'
            ? editor
            : walkShadowRoots(editor, root => root.querySelector('[contenteditable="true"]'))
              || (editor.tagName === 'TEXTAREA' ? editor : null);
          if (editable && editable.isConnected) return { host: editor, editable };
        }
        await sleep(150);
      }
      return null;
    }

    async function typeMultilinePrompt(editorInfo, text) {
      const { host, editable } = editorInfo;
      editable.focus();
      host.focus?.();

      if (editable.tagName === 'TEXTAREA' || editable.tagName === 'INPUT') {
        editable.value = text;
        editable.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }

      editable.textContent = '';
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));

      const lines = text.split(/\\r?\\n/);
      for (let i = 0; i < lines.length; i++) {
        document.execCommand('insertText', false, lines[i]);
        if (i < lines.length - 1) document.execCommand('insertParagraph');
      }
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      host.dispatchEvent?.(new InputEvent('input', { bubbles: true }));
      return true;
    }

    async function virtualPasteImage(base64, mime) {
      const byteChars = atob(base64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mime || 'image/png' });
      const file = new File([blob], 'panel.png', { type: mime || 'image/png' });

      const editorInfo = await findActiveEditor(3000);
      if (!editorInfo) return { success: false, error: 'No editor found' };

      const { host, editable } = editorInfo;
      const dt = new DataTransfer();
      dt.items.add(file);
      const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      Object.defineProperty(pasteEvent, 'clipboardData', { value: dt });
      host.dispatchEvent(pasteEvent);
      editable.dispatchEvent(pasteEvent);

      const start = Date.now();
      while (Date.now() - start < 8000) {
        const attached = queryAllDeep(document, 'img, [aria-label*="Remove"], [aria-label*="remove"]')
          .some(el => {
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            if (aria.includes('remove')) return true;
            if (el.tagName === 'IMG') {
              const w = el.naturalWidth || el.width || 0;
              return w > 40 && w < 500;
            }
            return false;
          });
        if (attached) return { success: true };
        await sleep(300);
      }
      return { success: false, error: 'Image attach not detected' };
    }

    async function scrollChatDown() {
      const containers = queryAllDeep(document, '[class*="conversation"], [class*="chat"], [class*="scroll"], main, [role="main"]');
      for (const c of containers) {
        if (c.scrollHeight > c.clientHeight) c.scrollTop = c.scrollHeight;
      }
      window.scrollTo(0, document.body.scrollHeight);
    }

    function isLoggedIn() {
      const pageText = (document.body.innerText || '').slice(0, 2000).toLowerCase();
      if (pageText.includes('meet gemini') && pageText.includes('sign in')) return false;
      const signIn = findByText(['sign in', 'sign up']);
      const chatInput = walkShadowRoots(document, r =>
        r.querySelector('rich-textarea, [contenteditable="true"][aria-label*="prompt"], [aria-label*="Ask Gemini"], textarea')
      );
      if (chatInput) return true;
      const avatar = queryAllDeep(document, 'img[src*="googleusercontent"], [data-test-id*="avatar"]');
      if (avatar.length > 0 && !signIn) return true;
      if (signIn && (signIn.textContent || '').toLowerCase().trim() === 'sign in') return false;
      return !!queryAllDeep(document, 'button[aria-label*="Send"], button[aria-label*="Attach"]').length;
    }
  `;

  function getWebview() {
    const wv = document.getElementById('gemini-webview');
    if (!wv) throw new Error('Gemini webview not found');
    return wv;
  }

  async function execInWebview(code) {
    const wv = getWebview();
    return wv.executeJavaScript(`(async function() { ${DOM_HELPERS}\n${code} })()`);
  }

  async function injectStyles() {
    const wv = getWebview();
    const css = await window.mangaAPI.getWebviewCss();
    wv.insertCSS(css);
  }

  async function initWebview() {
    const wv = getWebview();
    return new Promise((resolve) => {
      const onReady = async () => {
        try {
          await injectStyles();
        } catch {
          // non-fatal
        }
        resolve();
      };
      wv.addEventListener('dom-ready', onReady, { once: true });
      if (!wv.getURL() || wv.getURL() === 'about:blank') {
        wv.src = 'https://gemini.google.com/app';
      }
    });
  }

  async function navigateNewChat() {
    imageModeActive = false;
    const wv = getWebview();
    wv.src = 'https://gemini.google.com/app';
    await new Promise((r) => wv.addEventListener('dom-ready', r, { once: true }));
    await injectStyles();
    await delay(2000);
  }

  async function ensureImageMode() {
    if (imageModeActive) return { success: true };

    const result = await execInWebview(`
      await sleep(500);
      let attach = walkShadowRoots(document, root => root.querySelector('button[aria-label*="Attach"]'))
        || walkShadowRoots(document, root => root.querySelector('button[aria-label*="Add"]'))
        || findByText(['attach', 'add file', 'upload']);
      if (attach) {
        attach.click();
        await sleep(1000);
      }
      const imagesBtn = findByText(['create and edit images', 'create image', 'images', 'imagen', 'create & edit']);
      if (imagesBtn) {
        imagesBtn.click();
        await sleep(1500);
        return { success: true };
      }
      return { success: false, error: 'Images mode button not found' };
    `);

    if (result.success) imageModeActive = true;
    return result;
  }

  async function checkLogin() {
    return execInWebview(`return isLoggedIn()`);
  }

  async function restylePanel(imageBase64, prompt, onStatus) {
    try {
      if (onStatus) onStatus({ message: 'Opening new Gemini chat...', progress: 5 });
      await navigateNewChat();

      if (onStatus) onStatus({ message: 'Checking login status...', progress: 10 });
      const loggedIn = await checkLogin();
      if (!loggedIn) {
        return { success: false, error: 'Not logged in. Use Gemini Login or Bypass Login in Settings.' };
      }

      if (onStatus) onStatus({ message: 'Entering Images mode...', progress: 20 });
      const modeResult = await ensureImageMode();
      if (!modeResult.success) {
        return { success: false, error: modeResult.error || 'Could not enter Images mode' };
      }

      if (onStatus) onStatus({ message: 'Pasting manga panel...', progress: 35 });
      const pasteResult = await execInWebview(`
        return await virtualPasteImage(${JSON.stringify(imageBase64)}, 'image/png');
      `);
      if (!pasteResult.success) {
        return { success: false, error: pasteResult.error || 'Failed to attach image' };
      }

      if (onStatus) onStatus({ message: 'Typing optimized prompt...', progress: 50 });
      await execInWebview(`
        const editorInfo = await findActiveEditor(3000);
        if (!editorInfo) return { success: false, error: 'Editor not found after mode switch' };
        await typeMultilinePrompt(editorInfo, ${JSON.stringify(prompt)});
        return { success: true };
      `);

      if (onStatus) onStatus({ message: 'Sending to Gemini...', progress: 60 });
      await execInWebview(`
        const btn = await waitForSendEnabled(15000);
        if (!btn) return { success: false, error: 'Send button not enabled' };
        btn.click();
        return { success: true };
      `);

      if (onStatus) onStatus({ message: 'Waiting for generated image...', progress: 70 });

      const imageReady = await execInWebview(`
        const start = Date.now();
        const maxWait = 300000;
        let baseline = 0;
        while (Date.now() - start < maxWait) {
          await scrollChatDown();
          const images = queryAllDeep(document, 'img').filter(img => {
            const w = img.naturalWidth || img.width || 0;
            const h = img.naturalHeight || img.height || 0;
            const isInput = img.closest('[class*="input"], [class*="upload"], [class*="attachment"], [class*="user"]');
            const isOutput = img.closest('[class*="response"], [class*="model"], [class*="output"], [class*="assistant"], [class*="message"]');
            return w > 200 && h > 200 && !isInput && (isOutput || img.src.includes('googleusercontent') || img.src.includes('blob:'));
          });
          if (images.length > baseline) {
            await sleep(2000);
            return { success: true, count: images.length };
          }
          baseline = images.length;
          await sleep(2000);
        }
        return { success: false, error: 'Generation timed out' };
      `);

      if (!imageReady.success) {
        return { success: false, error: imageReady.error };
      }

      if (onStatus) onStatus({ message: 'Opening lightbox & downloading...', progress: 90 });

      const downloadPromise = window.mangaAPI.waitForDownload();

      const clickResult = await execInWebview(`
        await scrollChatDown();
        const images = queryAllDeep(document, 'img').filter(img => {
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          const isInput = img.closest('[class*="input"], [class*="upload"], [class*="attachment"], [class*="user"]');
          const isOutput = img.closest('[class*="response"], [class*="model"], [class*="output"], [class*="assistant"]');
          return w > 200 && h > 200 && !isInput && (isOutput || img.src.includes('googleusercontent') || img.src.includes('blob:'));
        });
        if (!images.length) return { success: false, error: 'Output image not found' };
        const target = images[images.length - 1];
        target.click();
        await sleep(1200);
        const dl = queryAllDeep(document, 'a[download], button, [role="button"]').find(el => {
          const t = (el.textContent || '').toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          return el.tagName === 'A' && el.hasAttribute('download') || t.includes('download') || aria.includes('download');
        });
        if (dl) { dl.click(); return { success: true }; }
        return { success: false, error: 'Download button not found in lightbox' };
      `);

      if (!clickResult.success) {
        return { success: false, error: clickResult.error };
      }

      const download = await downloadPromise;
      if (!download.success) {
        return { success: false, error: 'Download failed' };
      }

      if (onStatus) onStatus({ message: 'Keyframe complete!', progress: 100 });
      return { success: true, path: download.path, prompt };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function optimizePrompt(imagePath) {
    return window.mangaAPI.optimizePrompt({ imagePath });
  }

  async function generateKeyframe(panel, index, total, onStatus) {
    const prompt = await optimizePrompt(panel.path);
    const base64 = await window.mangaAPI.readFileBase64(panel.path);

    const result = await restylePanel(base64, prompt, (status) => {
      if (onStatus) {
        onStatus({
          message: status.message || `Generating keyframe ${index + 1} of ${total}...`,
          progress: status.progress,
        });
      }
    });

    if (result.success) {
      const savedPath = await window.mangaAPI.saveKeyframe({
        panelIndex: index,
        sourcePath: result.path,
      });
      return { ...result, path: savedPath };
    }

    return result;
  }

  function getActionPresets() {
    return ACTION_PRESETS;
  }

  async function describeKeyframe(imagePath) {
    try {
      const prompt = await optimizePrompt(imagePath);
      return prompt.slice(0, 200) + '...';
    } catch {
      return 'Anime character in dynamic combat pose with dramatic lighting and shadow energy effects';
    }
  }

  async function loginWithCookie(cookie) {
    if (cookie) await window.mangaAPI.injectGeminiCookies(cookie);
    const wv = getWebview();
    wv.src = 'https://gemini.google.com/app';
    await new Promise((r) => wv.addEventListener('dom-ready', r, { once: true }));
    await injectStyles();
    return { success: true };
  }

  async function openSignIn() {
    const wv = getWebview();
    wv.src = 'https://accounts.google.com/signin';
    return { success: true };
  }

  function positionGeminiDock(step) {
    const dock = document.getElementById('gemini-dock');
    if (!dock) return;
    if (step === 5) {
      const ph = document.querySelector('#step-5 .gemini-dock-placeholder');
      if (ph && ph.parentNode) ph.replaceWith(dock);
    } else if (step === 3) {
      const layout = document.querySelector('#step-3 .restyle-layout');
      if (layout && layout.firstChild !== dock) layout.insertBefore(dock, layout.firstChild);
    }
  }

  function focusGeminiPanel() {
    const wv = document.getElementById('gemini-webview');
    if (wv) wv.focus();
  }

  return {
    initWebview,
    restylePanel,
    generateKeyframe,
    getActionPresets,
    describeKeyframe,
    loginWithCookie,
    openSignIn,
    positionGeminiDock,
    focusGeminiPanel,
    checkLogin,
  };
})();
