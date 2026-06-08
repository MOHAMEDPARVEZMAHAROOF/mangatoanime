export const BASE_PROMPT = `You are a professional anime key animator working on an official Solo Leveling animated series production. Your task is to convert the uploaded manga panel into a fully rendered anime production cel.

CRITICAL RULES:
- Preserve EXACTLY: every character pose, body position, facial expression, camera angle, and panel composition from the manga image
- Do NOT add, remove, or reposition any characters or objects
- Do NOT change the perspective or framing
- Only add: color, lighting, linework polish, and anime rendering style

ART STYLE SPECIFICATIONS:
- Studio A-1 Pictures / MAPPA hybrid aesthetic
- Clean bold outlines: 2-3px on characters, 1px on background details
- Cel-shading with 3 light levels: highlight, midtone, shadow
- No watercolor, no painterly texture — clean flat anime production look
- Film grain: subtle 5% overlay
- Aspect ratio: preserve original panel ratio exactly

CHARACTER RENDERING:
Primary male protagonist (whenever present in panel):
- Hair: jet black, slightly blue-tinted highlight sheen, sharp spiky ends
- Eyes: solid glowing violet-purple (#7B3FF0), no pupils, inner light glow effect
- Skin: cool pale tone (#F0EBE3), sharp cheekbones, strong jaw
- Outfit: form-fitting black tactical bodysuit, subtle midnight blue sheen on fabric folds
- Shadow aura: deep violet-black particle energy (#1A0533) radiating from body outline

OUTPUT REQUIREMENTS:
- Single full illustration, no panel borders, no speech bubbles, no text
- Resolution: maximum available
- The result must look like a Solo Leveling anime production frame`;

export const THEME_PALETTES: Record<string, string> = {
  'solo-leveling': 'deep blacks, vivid purples and blues, pale skin, dark hair',
  naruto: 'vibrant oranges, deep blues, warm skin tones',
  'demon-slayer': 'crimson reds, charcoal blacks, dramatic contrast',
  custom: 'user-defined palette',
};

export const ACTION_PRESETS: Record<string, { action: string; camera: string }> = {
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

export function optimizePrompt(opts: {
  width: number;
  height: number;
  theme?: string;
  customColor?: string;
  customGeneralPrompt?: string;
}): string {
  const base = opts.customGeneralPrompt?.trim() || BASE_PROMPT;
  let prompt = base;
  const theme = opts.theme || 'solo-leveling';

  if (theme !== 'solo-leveling') {
    prompt += `\n\nCOLOR PALETTE OVERRIDE: ${theme === 'custom' ? opts.customColor : THEME_PALETTES[theme]}`;
  }
  if (opts.width > opts.height) {
    prompt = 'Landscape orientation. Wide cinematic framing.\n\n' + prompt;
  } else if (opts.height > opts.width * 1.3) {
    prompt = 'Vertical portrait panel composition.\n\n' + prompt;
  }

  prompt +=
    '\n\nCHARACTER ANCHOR: Korean manhwa cel-shaded anime. Male hunter, short black hair, glowing violet eyes, black combat armor, dark shadow aura, pale skin.';
  return prompt;
}

export function buildVideoPrompt(description: string, action: string, camera: string) {
  return `Anime cel-shaded style, cinematic. Starting from this exact frame: ${description}. ${action}. Camera: ${camera}. Slow-motion cinematic, 3D depth of field, volumetric lighting, 4K quality, 24fps film grain. END FREEZE: hold final pose.`;
}
