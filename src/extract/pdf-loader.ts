import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Turn uploaded PDFs and images into a canvas whose pixels are analysed.

// Auxiliary pdf.js data (CJK character maps, non-embedded fonts, JPEG 2000 /
// JBIG2 decoders, ICC profiles) is fetched on demand from here.
// Data folders copied from pdfjs-dist by scripts/copy-pdfjs-assets.mjs (before dev and build).
// Absolute, because pdf.js resolves relative URLs against its worker, not the page.
const PDFJS_DATA = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
// Stay under the most restrictive browser canvas area limit (iOS Safari).
export const MAX_CANVAS_PIXELS = 16_000_000;

type PdfjsLib = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsLib> | null = null;

async function importPdfjs(): Promise<PdfjsLib> {
  const lib = await import('pdfjs-dist');
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  return lib;
}

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = importPdfjs().catch((err) => {
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

export function fileKind(file: File | Blob) {
  const name = ((file as File).name || '').toLowerCase();
  const type = file.type || '';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type === 'application/zip' || type === 'application/x-zip-compressed' || name.endsWith('.zip')) return 'zip';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp|tiff?)$/.test(name)) return 'image';
  return 'unknown';
}

export async function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const lib = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const options = {
    data,
    isEvalSupported: false,
    cMapUrl: `${PDFJS_DATA}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_DATA}standard_fonts/`,
    wasmUrl: `${PDFJS_DATA}wasm/`,
    iccUrl: `${PDFJS_DATA}iccs/`,
  };
  return lib.getDocument(options).promise;
}

// Largest scale ≤ requested that keeps the canvas under MAX_CANVAS_PIXELS.
export function clampScale(width: number, height: number, scale: number) {
  const area = width * height * scale * scale;
  return area <= MAX_CANVAS_PIXELS ? scale : Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
}

// Render a 1-based page on a white background. Returns {canvas, scale}.
export async function renderPdfPage(doc: PDFDocumentProxy, pageNumber: number, requestedScale: number) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = clampScale(base.width, base.height, requestedScale);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  page.cleanup();
  return { canvas, scale };
}

export async function imageToCanvas(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = clampScale(bitmap.width, bitmap.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export function canvasImageData(canvas: HTMLCanvasElement) {
  return canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG.'))), 'image/png'),
  );
}

export async function sha256Hex(blob: Blob) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
