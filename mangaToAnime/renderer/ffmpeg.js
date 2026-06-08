/**
 * FFmpeg video export coordination
 */
const FfmpegHandler = (() => {
  async function exportFullVideo(clips, onProgress) {
    const clipPaths = clips.map((c) => c.path).filter(Boolean);

    if (!clipPaths.length) {
      throw new Error('No clips to export');
    }

    const unsubscribe = window.mangaAPI.onExportProgress((data) => {
      if (onProgress) onProgress(data);
    });

    try {
      const result = await window.mangaAPI.exportVideo({ clipPaths });
      return result;
    } finally {
      if (unsubscribe) unsubscribe();
    }
  }

  return {
    exportFullVideo,
  };
})();

if (typeof module !== 'undefined') module.exports = FfmpegHandler;
