const { contextBridge, ipcRenderer, webUtils } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const pdfjsDistPath = path.join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
const pdfjsLib = require(path.join(pdfjsDistPath, 'pdf.mjs'));
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(pdfjsDistPath, 'pdf.worker.mjs')
).href;

contextBridge.exposeInMainWorld('pdfjsLib', pdfjsLib);
contextBridge.exposeInMainWorld('getPathForFile', (file) => {
  try {
    return webUtils.getPathForFile(file);
  } catch {
    return file.path || null;
  }
});

contextBridge.exposeInMainWorld('mangaAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getWorkDirs: () => ipcRenderer.invoke('get-work-dirs'),
  selectPdf: () => ipcRenderer.invoke('select-pdf'),
  readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
  saveExtractedPanel: (data) => ipcRenderer.invoke('save-extracted-panel', data),
  optimizePrompt: (data) => ipcRenderer.invoke('optimize-prompt', data),
  generateKeyframeApi: (data) => ipcRenderer.invoke('generate-keyframe-api', data),
  generateKeyframeBrowser: (data) => ipcRenderer.invoke('generate-keyframe-browser', data),
  generateVideoBrowser: (data) => ipcRenderer.invoke('generate-video-browser', data),
  buildVideoPrompt: (data) => ipcRenderer.invoke('build-video-prompt', data),
  getVideoDuration: (videoPath) => ipcRenderer.invoke('get-video-duration', videoPath),
  generateThumbnail: (videoPath) => ipcRenderer.invoke('generate-thumbnail', videoPath),
  exportVideo: (data) => ipcRenderer.invoke('export-video', data),
  cleanupTemp: () => ipcRenderer.invoke('cleanup-temp'),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  showGeminiPanel: (show) => ipcRenderer.invoke('show-gemini-panel', show),
  geminiLogin: (data) => ipcRenderer.invoke('gemini-login', data),
  getBasePrompt: () => ipcRenderer.invoke('get-base-prompt'),

  onGenerationStatus: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('generation-status', handler);
    return () => ipcRenderer.removeListener('generation-status', handler);
  },
  onExportProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('export-progress', handler);
    return () => ipcRenderer.removeListener('export-progress', handler);
  },
});
