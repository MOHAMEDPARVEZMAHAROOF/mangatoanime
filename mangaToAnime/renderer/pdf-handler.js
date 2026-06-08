/**
 * PDF rendering and high-resolution panel extraction using pdf.js
 */
const PdfHandler = (() => {
  let pdfDoc = null;

  const DPI = 300;
  const PDF_DPI = 72;

  async function loadPdf(filePath, buffer) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    pdfDoc = await window.pdfjsLib.getDocument({ data }).promise;
    return pdfDoc.numPages;
  }

  async function renderPageThumbnail(pageNum, maxWidth = 200) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const scale = maxWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
    return canvas.toDataURL('image/png');
  }

  async function renderAllThumbnails(onProgress) {
    const thumbnails = [];
    const total = pdfDoc.numPages;

    for (let i = 1; i <= total; i++) {
      const dataUrl = await renderPageThumbnail(i);
      thumbnails.push({ pageIndex: i - 1, pageNum: i, dataUrl });
      if (onProgress) onProgress(i / total);
    }

    return thumbnails;
  }

  async function extractPageHighRes(pageIndex) {
    const page = await pdfDoc.getPage(pageIndex + 1);
    const scale = DPI / PDF_DPI;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
  }

  async function extractPages(pageIndices, onProgress) {
    const results = [];
    const total = pageIndices.length;

    for (let i = 0; i < total; i++) {
      const pageIndex = pageIndices[i];
      const dataUrl = await extractPageHighRes(pageIndex);
      const savedPath = await window.mangaAPI.saveExtractedPanel({ pageIndex, dataUrl });
      results.push({ pageIndex, dataUrl, path: savedPath });
      if (onProgress) onProgress((i + 1) / total, i + 1, total);
    }

    return results;
  }

  function getPageCount() {
    return pdfDoc ? pdfDoc.numPages : 0;
  }

  return {
    loadPdf,
    renderAllThumbnails,
    extractPages,
    getPageCount,
  };
})();
