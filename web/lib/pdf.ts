'use client';

import type { PDFDocumentProxy } from 'pdfjs-dist';

const DPI = 300;
const PDF_DPI = 72;

let pdfDoc: PDFDocumentProxy | null = null;

export async function loadPdf(buffer: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  pdfDoc = await pdfjs.getDocument({ data: buffer }).promise;
  return pdfDoc.numPages;
}

async function renderPage(pageNum: number, scale: number) {
  if (!pdfDoc) throw new Error('PDF not loaded');
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

export async function renderAllThumbnails(maxWidth = 200) {
  if (!pdfDoc) return [];
  const thumbnails = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const scale = maxWidth / viewport.width;
    const dataUrl = await renderPage(i, scale);
    thumbnails.push({ pageIndex: i - 1, pageNum: i, dataUrl });
  }
  return thumbnails;
}

export async function extractPageHighRes(pageIndex: number) {
  const scale = DPI / PDF_DPI;
  return renderPage(pageIndex + 1, scale);
}
