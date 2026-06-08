/**
 * Veo video generation coordination
 */
const VeoHandler = (() => {
  async function buildPrompt(keyframe, action, cameraMove) {
    const description = keyframe.description ||
      'Anime character in cinematic combat scene with dramatic lighting and shadow energy';

    return window.mangaAPI.buildVideoPrompt({
      description,
      action,
      cameraMove,
    });
  }

  async function generateClip(keyframe, prompt, clipIndex, total) {
    await window.mangaAPI.showGeminiPanel(true);

    const result = await window.mangaAPI.generateVideoBrowser({
      imagePath: keyframe.path,
      videoPrompt: prompt,
      clipIndex,
      total,
    });

    if (result.success) {
      const duration = await window.mangaAPI.getVideoDuration(result.path);
      let thumbnail = null;
      try {
        thumbnail = await window.mangaAPI.generateThumbnail(result.path);
      } catch {
        // Thumbnail optional
      }

      return {
        ...result,
        duration,
        thumbnail,
        clipIndex,
        prompt,
      };
    }

    return result;
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

      const result = await generateClip(keyframe, prompt, i, keyframes.length);

      if (!result.success) {
        return { success: false, error: result.error, clips, failedIndex: i };
      }

      clips.push(result);

      if (result.seedPath) {
        referenceImage = result.seedPath;
      }

      if (onClipComplete) onClipComplete(result, i);
    }

    return { success: true, clips };
  }

  return {
    buildPrompt,
    generateClip,
    generateClipChain,
  };
})();

if (typeof module !== 'undefined') module.exports = VeoHandler;
