const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const POLL_INTERVAL = 2000;
const MAX_WAIT_MS = 300000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function injectCookies(session, cookieString) {
  if (!cookieString || !cookieString.trim()) return;

  const pairs = cookieString.split(';').map((s) => s.trim()).filter(Boolean);
  const cookies = pairs.map((pair) => {
    const eq = pair.indexOf('=');
    if (eq === -1) return null;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    return {
      url: 'https://gemini.google.com',
      name,
      value,
      domain: '.google.com',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'no_restriction',
    };
  }).filter(Boolean);

  for (const cookie of cookies) {
    try {
      await session.cookies.set(cookie);
    } catch {
      // Some cookies may fail — continue
    }
  }
}

async function waitForSelector(webContents, selector, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await webContents.executeJavaScript(`
      !!document.querySelector(${JSON.stringify(selector)})
    `);
    if (found) return true;
    await delay(500);
  }
  return false;
}

async function clickElement(webContents, selectors) {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  return webContents.executeJavaScript(`
    (function() {
      const selectors = ${JSON.stringify(selectorList)};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.click();
          return { success: true, selector: sel };
        }
      }
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], mat-icon-button'));
      for (const btn of buttons) {
        const text = (btn.textContent || '').toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('new chat') || aria.includes('menu') || text === '+' || aria.includes('add')) {
          btn.click();
          return { success: true, selector: 'heuristic-new-chat' };
        }
      }
      return { success: false };
    })()
  `);
}

async function navigateToNewChat(webContents) {
  await webContents.loadURL('https://gemini.google.com/app');
  await delay(3000);

  await clickElement(webContents, [
    'button[aria-label*="New chat"]',
    'button[aria-label*="new chat"]',
    '[data-test-id="new-chat-button"]',
    'button.new-chat-button',
  ]);
  await delay(1500);
}

async function clickCreateImage(webContents) {
  const result = await webContents.executeJavaScript(`
    (function() {
      const items = Array.from(document.querySelectorAll('button, [role="menuitem"], [role="option"], a, span'));
      for (const item of items) {
        const text = (item.textContent || '').toLowerCase();
        const aria = (item.getAttribute('aria-label') || '').toLowerCase();
        if (
          text.includes('create image') ||
          text.includes('generate image') ||
          aria.includes('create image') ||
          aria.includes('imagen')
        ) {
          item.click();
          return { success: true };
        }
      }
      const tools = Array.from(document.querySelectorAll('[class*="tool"], [class*="mode"]'));
      for (const t of tools) {
        if ((t.textContent || '').toLowerCase().includes('image')) {
          t.click();
          return { success: true };
        }
      }
      return { success: false };
    })()
  `);
  await delay(2000);
  return result;
}

async function uploadImage(webContents, imagePath) {
  const imageBase64 = (await fsp.readFile(imagePath)).toString('base64');
  const mimeType = 'image/png';

  return webContents.executeJavaScript(`
    (async function() {
      const base64 = ${JSON.stringify(imageBase64)};
      const mime = ${JSON.stringify(mimeType)};

      const byteChars = atob(base64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mime });
      const file = new File([blob], 'panel.png', { type: mime });

      const fileInputs = document.querySelectorAll('input[type="file"]');
      if (fileInputs.length > 0) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInputs[fileInputs.length - 1].files = dt.files;
        fileInputs[fileInputs.length - 1].dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, method: 'file-input' };
      }

      const attachButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const btn of attachButtons) {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('upload') || aria.includes('attach') || aria.includes('add file') || aria.includes('insert')) {
          btn.click();
          await new Promise(r => setTimeout(r, 1000));
          const inputs = document.querySelectorAll('input[type="file"]');
          if (inputs.length > 0) {
            const dt = new DataTransfer();
            dt.items.add(file);
            inputs[inputs.length - 1].files = dt.files;
            inputs[inputs.length - 1].dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, method: 'attach-button' };
          }
        }
      }

      return { success: false, error: 'No file input found' };
    })()
  `);
}

async function pastePrompt(webContents, prompt) {
  return webContents.executeJavaScript(`
    (function() {
      const prompt = ${JSON.stringify(prompt)};
      const selectors = [
        'div[contenteditable="true"]',
        'textarea',
        '[aria-label*="Enter a prompt"]',
        '[aria-label*="prompt"]',
        '.ql-editor',
        'rich-textarea textarea',
        'div.input-area textarea',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            el.value = prompt;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            el.focus();
            el.textContent = prompt;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt }));
          }
          return { success: true, selector: sel };
        }
      }
      return { success: false };
    })()
  `);
}

async function clickSend(webContents) {
  return webContents.executeJavaScript(`
    (function() {
      const selectors = [
        'button[aria-label*="Send"]',
        'button[send-button]',
        'button[data-test-id="send-button"]',
        'button[mattooltip*="Send"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && !el.disabled) {
          el.click();
          return { success: true };
        }
      }
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('send') && !btn.disabled) {
          btn.click();
          return { success: true };
        }
      }
      return { success: false };
    })()
  `);
}

async function scrollChatDown(webContents) {
  return webContents.executeJavaScript(`
    (function() {
      const containers = document.querySelectorAll(
        '[class*="conversation"], [class*="chat"], [class*="scroll"], main, [role="main"]'
      );
      for (const c of containers) {
        if (c.scrollHeight > c.clientHeight) {
          c.scrollTop = c.scrollHeight;
        }
      }
      window.scrollTo(0, document.body.scrollHeight);
      return { success: true };
    })()
  `);
}

async function waitForGeneratedImage(webContents, onStatus) {
  const start = Date.now();
  let lastCount = 0;

  while (Date.now() - start < MAX_WAIT_MS) {
    const state = await webContents.executeJavaScript(`
      (function() {
        const images = Array.from(document.querySelectorAll('img'));
        const generated = images.filter(img => {
          const src = img.src || '';
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          const parent = img.closest('[class*="response"], [class*="model"], [class*="output"], [class*="message"]');
          const isInput = img.closest('[class*="input"], [class*="upload"], [class*="attachment"], [class*="user"]');
          return w > 200 && h > 200 && !isInput && (parent || src.includes('googleusercontent') || src.includes('blob:'));
        });
        return {
          count: generated.length,
          lastSrc: generated.length ? generated[generated.length - 1].src : null,
        };
      })()
    `);

    if (onStatus) {
      onStatus({
        message: `Waiting for image generation... (${Math.round((Date.now() - start) / 1000)}s)`,
        progress: Math.min(90, ((Date.now() - start) / MAX_WAIT_MS) * 90),
      });
    }

    if (state.count > lastCount && state.lastSrc) {
      await delay(2000);
      await scrollChatDown(webContents);
      return state;
    }
    lastCount = state.count;

    await scrollChatDown(webContents);
    await delay(POLL_INTERVAL);
  }

  throw new Error('Image generation timed out');
}

async function downloadGeneratedImage(webContents, outputPath) {
  const imageInfo = await webContents.executeJavaScript(`
    (function() {
      const images = Array.from(document.querySelectorAll('img'));
      const generated = images.filter(img => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        const isInput = img.closest('[class*="input"], [class*="upload"], [class*="attachment"], [class*="user"]');
        const isOutput = img.closest('[class*="response"], [class*="model"], [class*="output"], [class*="message"], [class*="assistant"]');
        return w > 200 && h > 200 && !isInput && (isOutput || img.src.includes('googleusercontent') || img.src.includes('blob:'));
      });

      if (!generated.length) return { success: false };

      const target = generated[generated.length - 1];
      target.click();

      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      for (const btn of buttons) {
        const text = (btn.textContent || '').toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes('download') || aria.includes('download') || aria.includes('save')) {
          btn.click();
          return { success: true, src: target.src, clickedDownload: true };
        }
      }

      return { success: true, src: target.src, clickedDownload: false };
    })()
  `);

  if (!imageInfo.success) {
    throw new Error('Could not find generated output image');
  }

  if (imageInfo.src.startsWith('data:')) {
    const base64 = imageInfo.src.split(',')[1];
    await fsp.writeFile(outputPath, Buffer.from(base64, 'base64'));
    return { success: true, path: outputPath };
  }

  if (imageInfo.src.startsWith('blob:') || imageInfo.src.startsWith('http')) {
    const dataUrl = await webContents.executeJavaScript(`
      (async function() {
        const src = ${JSON.stringify(imageInfo.src)};
        const resp = await fetch(src);
        const blob = await resp.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      })()
    `);
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    await fsp.writeFile(outputPath, Buffer.from(base64, 'base64'));
    return { success: true, path: outputPath };
  }

  throw new Error('Unable to download generated image');
}

async function runImageGenerationAutomation(webContents, imagePath, prompt, outputPath, onStatus) {
  try {
    if (onStatus) onStatus({ message: 'Opening new Gemini chat...', progress: 5 });

    await navigateToNewChat(webContents);
    if (onStatus) onStatus({ message: 'Clicking create image...', progress: 15 });

    await clickCreateImage(webContents);
    if (onStatus) onStatus({ message: 'Uploading manga panel...', progress: 25 });

    const uploadResult = await uploadImage(webContents, imagePath);
    if (!uploadResult.success) {
      throw new Error(uploadResult.error || 'Failed to upload image');
    }

    await delay(2000);
    if (onStatus) onStatus({ message: 'Pasting optimized prompt...', progress: 35 });

    await pastePrompt(webContents, prompt);
    await delay(500);
    await clickSend(webContents);

    if (onStatus) onStatus({ message: 'Generating anime keyframe...', progress: 45 });

    await waitForGeneratedImage(webContents, onStatus);
    if (onStatus) onStatus({ message: 'Downloading output image...', progress: 92 });

    const result = await downloadGeneratedImage(webContents, outputPath);

    if (onStatus) onStatus({ message: 'Keyframe complete!', progress: 100 });

    return { success: true, path: result.path, prompt };
  } catch (err) {
    return { success: false, error: err.message, prompt };
  }
}

async function runVideoGenerationAutomation(webContents, imagePath, prompt, outputPath, downloadDir, onStatus) {
  try {
    if (onStatus) onStatus({ message: 'Opening new Gemini chat for video...', progress: 5 });

    await navigateToNewChat(webContents);
    await delay(2000);

    if (onStatus) onStatus({ message: 'Selecting video generation mode...', progress: 15 });

    await webContents.executeJavaScript(`
      (function() {
        const items = Array.from(document.querySelectorAll('button, [role="menuitem"], span, a'));
        for (const item of items) {
          const text = (item.textContent || '').toLowerCase();
          if (text.includes('video') || text.includes('veo')) {
            item.click();
            return true;
          }
        }
        return false;
      })()
    `);
    await delay(2000);

    if (onStatus) onStatus({ message: 'Uploading keyframe reference...', progress: 25 });

    const uploadResult = await uploadImage(webContents, imagePath);
    if (!uploadResult.success) {
      throw new Error('Failed to upload keyframe for video');
    }

    await delay(2000);
    if (onStatus) onStatus({ message: 'Submitting video prompt...', progress: 35 });

    await pastePrompt(webContents, prompt);
    await clickSend(webContents);

    if (onStatus) onStatus({ message: 'Generating video clip...', progress: 50 });

    const start = Date.now();
    let videoFound = false;

    while (Date.now() - start < MAX_WAIT_MS) {
      const state = await webContents.executeJavaScript(`
        (function() {
          const videos = Array.from(document.querySelectorAll('video'));
          const downloadable = videos.filter(v => v.src && v.readyState >= 2);
          return {
            count: downloadable.length,
            src: downloadable.length ? downloadable[downloadable.length - 1].src : null,
          };
        })()
      `);

      if (onStatus) {
        onStatus({
          message: `Generating video... (${Math.round((Date.now() - start) / 1000)}s)`,
          progress: Math.min(90, 50 + ((Date.now() - start) / MAX_WAIT_MS) * 40),
        });
      }

      if (state.src) {
        videoFound = true;
        const dataUrl = await webContents.executeJavaScript(`
          (async function() {
            const src = ${JSON.stringify(state.src)};
            const resp = await fetch(src);
            const blob = await resp.blob();
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          })()
        `);

        if (dataUrl && dataUrl.startsWith('data:')) {
          const base64 = dataUrl.replace(/^data:video\/\w+;base64,/, '');
          await fsp.writeFile(outputPath, Buffer.from(base64, 'base64'));
          if (onStatus) onStatus({ message: 'Video clip saved!', progress: 100 });
          return { success: true, path: outputPath };
        }
      }

      await scrollChatDown(webContents);
      await delay(POLL_INTERVAL);
    }

    if (!videoFound) {
      throw new Error('Video generation timed out');
    }

    return { success: false, error: 'Could not download video' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  injectCookies,
  runImageGenerationAutomation,
  runVideoGenerationAutomation,
};
