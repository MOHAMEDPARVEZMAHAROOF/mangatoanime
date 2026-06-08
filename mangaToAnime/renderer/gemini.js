/**
 * Gemini image restyling coordination
 */
const GeminiHandler = (() => {
  const IMAGE_SYSTEM_PROMPT = `You are an anime art director. Convert this black and white manga panel into a fully colored anime keyframe. Style rules: Korean manhwa cel-shaded anime aesthetic, thick clean outlines, dramatic cinematic lighting, high contrast. Color palette: deep blacks, vivid purples and blues for shadow energy effects, pale skin tones, dark hair. Do NOT change the character poses, composition, or panel layout from the original. Only add color, lighting, and anime style. Output as a single clean illustration with no panel borders or text bubbles. Make it look like a production-quality anime screenshot.`;

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

  async function optimizePrompt(imagePath, themeId, customPalette) {
    return window.mangaAPI.optimizePrompt({ imagePath, themeId, customPalette });
  }

  async function generateKeyframe(panel, index, total, useBrowser = true) {
    const prompt = await optimizePrompt(panel.path);

    if (!useBrowser) {
      const apiResult = await window.mangaAPI.generateKeyframeApi({
        imagePath: panel.path,
        prompt,
      });

      if (apiResult.path) {
        return { success: true, path: apiResult.path, prompt: apiResult.prompt };
      }
    }

    await window.mangaAPI.showGeminiPanel(true);

    const result = await window.mangaAPI.generateKeyframeBrowser({
      imagePath: panel.path,
      panelIndex: index,
      total,
    });

    return result;
  }

  function getActionPresets() {
    return ACTION_PRESETS;
  }

  function getSystemPrompt() {
    return IMAGE_SYSTEM_PROMPT;
  }

  async function describeKeyframe(imagePath) {
    const settings = await window.mangaAPI.getSettings();
    if (!settings.apiKey) {
      return 'Anime character in dynamic combat pose with dramatic lighting and shadow energy effects';
    }

    try {
      const prompt = await optimizePrompt(imagePath);
      return prompt.slice(0, 200) + '...';
    } catch {
      return 'Anime character in dynamic combat pose with dramatic lighting';
    }
  }

  return {
    optimizePrompt,
    generateKeyframe,
    getActionPresets,
    getSystemPrompt,
    describeKeyframe,
  };
})();

if (typeof module !== 'undefined') module.exports = GeminiHandler;
