import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import JsBarcode from 'jsbarcode';
import { createWorker, PSM, type Worker as OcrWorker } from 'tesseract.js';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CameraIcon,
  PhotoIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  DEFAULT_FORMAT,
  DEFAULT_OUTPUT_FORMAT,
  FORMAT_OPTIONS,
  formatToWasm,
  formatToZxing,
  parseFormatParam,
  parseReadParam,
  scanPath,
  type OutputFormatValue,
  type ReadMode,
} from '../lib/barcodeFormats';
import {
  pageCardClass,
  pageChoiceCardClass,
  pageInputClass,
  pageLabelClass,
  pagePrimaryButtonClass,
  pageSecondaryButtonClass,
  pageSubtitleClass,
  pageTitleClass,
} from '../lib/pageUi';

const CANVAS_SIZE = 1000;
const OCR_MIN_DIGITS = 6;
const DECODE_MAX = 2800;
const VARIANT_MAX = 1600;
const UPSCALE_MIN = 1000;
const DECODE_BUDGET_MS = 12_000;
const SQUARE_GUIDE = 0.86;
const NUMBER_GUIDE_WIDTH = 0.9;
const NUMBER_GUIDE_HEIGHT = 0.18 * 1.25 * 1.25;
const LIVE_BARCODE_MS = 180;
const LIVE_NUMBERS_MS = 480;

type DecodeHit = { text: string; format: string };
type EngineMode = 'both' | 'js';
type DecodeProgress = (hint: string) => void;
type WasmReadBarcodes = (typeof import('zxing-wasm/reader'))['readBarcodes'];
type WasmWriteBarcode = (typeof import('zxing-wasm/writer'))['writeBarcode'];

function wasmReaderOptions(format: string) {
  return {
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    formats: [formatToWasm(format)],
    maxNumberOfSymbols: 1,
  };
}

let wasmReadPromise: Promise<WasmReadBarcodes | null> | null = null;
let wasmWritePromise: Promise<WasmWriteBarcode | null> | null = null;

function barcodePayload(code: string): string {
  return code.replace(/[\r\n]/g, '');
}

function displayCode(code: string): string {
  return barcodePayload(code).replace(/^ +| +$/g, '').split('').join(' ');
}

function isPhoneDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPod|Android.+Mobile/i.test(ua)) return true;
  return window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 900;
}

function nowTicketDate() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yy} ${hh}:${min}`;
}

function createReader(format: string) {
  const hints = new Map<DecodeHintType, BarcodeFormat[] | boolean>();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [formatToZxing(format)]);
  return new BrowserMultiFormatReader(hints);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

function sourceSize(source: HTMLImageElement | HTMLCanvasElement) {
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }
  return { width: source.width, height: source.height };
}

function fillWhite(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.save();
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function imageToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  max = DECODE_MAX,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const { width, height } = sourceSize(source);
  const scale = Math.min(1, max / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  fillWhite(ctx, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function contrastCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  contrast: number,
  max = DECODE_MAX,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const { width, height } = sourceSize(source);
  const scale = Math.min(1, max / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  fillWhite(ctx, canvas.width, canvas.height);
  ctx.filter = `grayscale(1) contrast(${contrast})`;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, value));
}

function otsuThreshold(hist: Uint32Array, total: number) {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) ** 2;
    if (variance > maxVar) {
      maxVar = variance;
      threshold = t;
    }
  }
  return threshold;
}

function thresholdCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  max = VARIANT_MAX,
): HTMLCanvasElement {
  const canvas = imageToCanvas(source, max);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const hist = new Uint32Array(256);
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const value = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    gray[p] = value;
    hist[value] += 1;
  }
  const threshold = otsuThreshold(hist, gray.length);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const value = gray[p] > threshold ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function invertCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  max = VARIANT_MAX,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const { width, height } = sourceSize(source);
  const scale = Math.min(1, max / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  fillWhite(ctx, canvas.width, canvas.height);
  ctx.filter = 'invert(1) grayscale(1) contrast(1.4)';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function sharpenCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  max = VARIANT_MAX,
): HTMLCanvasElement {
  const canvas = imageToCanvas(source, max);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const blur = document.createElement('canvas');
  blur.width = canvas.width;
  blur.height = canvas.height;
  const blurCtx = blur.getContext('2d');
  if (!blurCtx) return canvas;
  blurCtx.filter = 'blur(1.4px)';
  blurCtx.drawImage(canvas, 0, 0);
  const sharp = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const blurred = blurCtx.getImageData(0, 0, canvas.width, canvas.height);
  const amount = 1.6;
  for (let i = 0; i < sharp.data.length; i += 4) {
    sharp.data[i] = clampByte(sharp.data[i] + (sharp.data[i] - blurred.data[i]) * amount);
    sharp.data[i + 1] = clampByte(
      sharp.data[i + 1] + (sharp.data[i + 1] - blurred.data[i + 1]) * amount,
    );
    sharp.data[i + 2] = clampByte(
      sharp.data[i + 2] + (sharp.data[i + 2] - blurred.data[i + 2]) * amount,
    );
  }
  ctx.putImageData(sharp, 0, 0);
  return canvas;
}

function rotateCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  degrees: number,
  max = VARIANT_MAX,
): HTMLCanvasElement {
  const base = imageToCanvas(source, max);
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(base.width * cos + base.height * sin));
  canvas.height = Math.max(1, Math.round(base.width * sin + base.height * cos));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(base, -base.width / 2, -base.height / 2);
  return canvas;
}

function cropCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  leftRatio: number,
  topRatio: number,
  widthRatio: number,
  heightRatio: number,
  max = VARIANT_MAX,
): HTMLCanvasElement {
  const { width, height } = sourceSize(source);
  const sx = Math.round(width * leftRatio);
  const sy = Math.round(height * topRatio);
  const sw = Math.max(1, Math.round(width * widthRatio));
  const sh = Math.max(1, Math.round(height * heightRatio));
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, max / Math.max(sw, sh));
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  fillWhite(ctx, canvas.width, canvas.height);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function upscaleCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  factor = 2,
  max = VARIANT_MAX,
): HTMLCanvasElement {
  const { width, height } = sourceSize(source);
  const canvas = document.createElement('canvas');
  const targetW = width * factor;
  const targetH = height * factor;
  const scale = Math.min(1, max / Math.max(targetW, targetH));
  canvas.width = Math.max(1, Math.round(targetW * scale));
  canvas.height = Math.max(1, Math.round(targetH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  fillWhite(ctx, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function snapshotVideo(video: HTMLVideoElement, max = VARIANT_MAX): HTMLCanvasElement | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, max / Math.max(vw, vh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vw * scale));
  canvas.height = Math.max(1, Math.round(vh * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  fillWhite(ctx, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropGuideFromVideo(
  video: HTMLVideoElement,
  container: HTMLElement,
  guideWidth: number,
  guideHeight: number,
  max = VARIANT_MAX,
): HTMLCanvasElement | null {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !cw || !ch) return null;

  const scale = Math.max(cw / vw, ch / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const offX = (cw - dispW) / 2;
  const offY = (ch - dispH) / 2;

  const boxW = cw * guideWidth;
  const boxH = ch * guideHeight;
  const boxX = (cw - boxW) / 2;
  const boxY = (ch - boxH) / 2;

  const sx = (boxX - offX) / scale;
  const sy = (boxY - offY) / scale;
  const sw = boxW / scale;
  const sh = boxH / scale;

  const canvas = document.createElement('canvas');
  const outScale = Math.min(1, max / Math.max(sw, sh));
  canvas.width = Math.max(1, Math.round(sw * outScale));
  canvas.height = Math.max(1, Math.round(sh * outScale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  fillWhite(ctx, canvas.width, canvas.height);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function yieldToUi() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function getWasmRead() {
  if (!wasmReadPromise) {
    wasmReadPromise = (async () => {
      try {
        const [mod, wasmMod] = await Promise.all([
          import('zxing-wasm/reader'),
          import('zxing-wasm/reader/zxing_reader.wasm?url'),
        ]);
        const wasmUrl = wasmMod.default;
        mod.prepareZXingModule({
          overrides: {
            locateFile: (path: string, prefix: string) =>
              path.endsWith('.wasm') ? wasmUrl : `${prefix}${path}`,
          },
        });
        return mod.readBarcodes;
      } catch {
        return null;
      }
    })();
  }
  return wasmReadPromise;
}

function getWasmWrite() {
  if (!wasmWritePromise) {
    wasmWritePromise = (async () => {
      try {
        const [mod, wasmMod] = await Promise.all([
          import('zxing-wasm/writer'),
          import('zxing-wasm/writer/zxing_writer.wasm?url'),
        ]);
        const wasmUrl = wasmMod.default;
        mod.prepareZXingModule({
          overrides: {
            locateFile: (path: string, prefix: string) =>
              path.endsWith('.wasm') ? wasmUrl : `${prefix}${path}`,
          },
        });
        return mod.writeBarcode;
      } catch {
        return null;
      }
    })();
  }
  return wasmWritePromise;
}

function writerFormat(format: string): 'Code128' | 'Code39' | 'EAN13' | 'EAN8' | 'UPCA' | 'ITF' | 'Codabar' | null {
  switch (format) {
    case 'CODE128':
      return 'Code128';
    case 'CODE39':
      return 'Code39';
    case 'EAN13':
      return 'EAN13';
    case 'EAN8':
      return 'EAN8';
    case 'UPC':
      return 'UPCA';
    case 'ITF':
      return 'ITF';
    case 'codabar':
      return 'Codabar';
    default:
      return null;
  }
}

function mapWasmFormat(format: string): string {
  const key = format.replace(/[\s_-]/g, '').toLowerCase();
  if (key.includes('code39') || key === 'code32' || key === 'pzn') return 'CODE39';
  if (key.includes('code128')) return 'CODE128';
  if (key.includes('ean8')) return 'EAN8';
  if (key.includes('ean13') || key === 'isbn') return 'EAN13';
  if (key.includes('upc')) return 'UPC';
  if (key.includes('itf')) return 'ITF';
  if (key.includes('codabar')) return 'codabar';
  return 'CODE128';
}

function pickWasmHit(
  results: Awaited<ReturnType<WasmReadBarcodes>>,
  expectedFormat: string,
): DecodeHit | null {
  const match = results.find((result) => result.isValid);
  if (!match) return null;
  if (mapWasmFormat(match.format) !== expectedFormat) return null;
  return { text: match.text, format: expectedFormat };
}

async function tryWasmInput(
  readWasm: WasmReadBarcodes | null,
  input: Blob | ImageData,
  expectedFormat: string,
): Promise<DecodeHit | null> {
  if (!readWasm) return null;
  try {
    return pickWasmHit(await readWasm(input, wasmReaderOptions(expectedFormat)), expectedFormat);
  } catch {
    return null;
  }
}

function canvasImageData(canvas: HTMLCanvasElement): ImageData | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

async function tryDecodeCanvas(
  canvas: HTMLCanvasElement,
  reader: BrowserMultiFormatReader,
  readWasm: WasmReadBarcodes | null,
  engines: EngineMode,
  expectedFormat: string,
): Promise<DecodeHit | null> {
  if (engines !== 'js') {
    const imageData = canvasImageData(canvas);
    if (imageData) {
      const hit = await tryWasmInput(readWasm, imageData, expectedFormat);
      if (hit) return hit;
    }
  }
  try {
    const result = reader.decodeFromCanvas(canvas);
    if (mapZxingFormat(result.getBarcodeFormat()) !== expectedFormat) return null;
    return { text: result.getText(), format: expectedFormat };
  } catch {
    return null;
  }
}

async function decodeLiveFrame(
  canvas: HTMLCanvasElement,
  reader: BrowserMultiFormatReader,
  readWasm: WasmReadBarcodes | null,
  variantIndex: number,
  expectedFormat: string,
): Promise<DecodeHit | null> {
  const variants = [
    () => canvas,
    () => contrastCanvas(canvas, 1.6, VARIANT_MAX),
    () => contrastCanvas(canvas, 2.4, VARIANT_MAX),
    () => thresholdCanvas(canvas, VARIANT_MAX),
    () => invertCanvas(canvas, VARIANT_MAX),
  ];
  return tryDecodeCanvas(
    variants[variantIndex % variants.length](),
    reader,
    readWasm,
    'both',
    expectedFormat,
  );
}

function extractDigits(text: string): string {
  const compact = text.replace(/\D/g, '');
  if (compact) return compact;
  const runs = text.match(/\d+/g) ?? [];
  return runs.sort((a, b) => b.length - a.length)[0] ?? '';
}

function pickBestDigits(samples: string[]): string {
  const usable = samples.filter((sample) => sample.length >= OCR_MIN_DIGITS);
  if (usable.length === 0) return '';
  const maxLen = Math.max(...usable.map((sample) => sample.length));
  const longest = usable.filter((sample) => sample.length === maxLen);
  const counts = new Map<string, number>();
  for (const sample of longest) {
    counts.set(sample, (counts.get(sample) ?? 0) + 1);
  }
  let best = longest[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

async function decodeBarcode(
  url: string,
  expectedFormat: string,
  onProgress?: DecodeProgress,
): Promise<DecodeHit> {
  const deadline = Date.now() + DECODE_BUDGET_MS;
  const reader = createReader(expectedFormat);
  const readWasm = await getWasmRead();

  try {
    const result = await reader.decodeFromImageUrl(url);
    if (mapZxingFormat(result.getBarcodeFormat()) === expectedFormat) {
      return { text: result.getText(), format: expectedFormat };
    }
  } catch {
    // Photo tickets are often low-contrast; try processed canvases.
  }

  let img: HTMLImageElement;
  try {
    img = await loadImage(url);
  } catch {
    throw new Error('not found');
  }

  // Flatten onto white first — transparent PNG bars look solid-black to WASM.
  const full = imageToCanvas(img, DECODE_MAX);
  const fullHit = await tryDecodeCanvas(full, reader, readWasm, 'both', expectedFormat);
  if (fullHit) return fullHit;

  onProgress?.('Still trying — enhancing the photo...');

  const stage2: Array<() => HTMLCanvasElement> = [
    () => contrastCanvas(img, 1.4, VARIANT_MAX),
    () => contrastCanvas(img, 2, VARIANT_MAX),
    () => contrastCanvas(img, 2.8, VARIANT_MAX),
    () => contrastCanvas(img, 3.6, VARIANT_MAX),
    () => thresholdCanvas(img),
    () => invertCanvas(img),
    () => sharpenCanvas(img),
  ];

  for (const make of stage2) {
    if (Date.now() > deadline) break;
    await yieldToUi();
    const hit = await tryDecodeCanvas(make(), reader, readWasm, 'both', expectedFormat);
    if (hit) return hit;
  }

  const stage3: Array<{ make: () => HTMLCanvasElement; engines: EngineMode }> = [
    { make: () => rotateCanvas(img, 90), engines: 'js' },
    { make: () => rotateCanvas(img, 180), engines: 'js' },
    { make: () => rotateCanvas(img, 270), engines: 'js' },
    { make: () => rotateCanvas(img, 10), engines: 'both' },
    { make: () => rotateCanvas(img, -10), engines: 'both' },
    { make: () => rotateCanvas(img, 20), engines: 'both' },
    { make: () => rotateCanvas(img, -20), engines: 'both' },
    { make: () => cropCanvas(img, 0, 0.25, 1, 0.5), engines: 'both' },
    { make: () => cropCanvas(img, 0.15, 0.15, 0.7, 0.7), engines: 'both' },
  ];

  const { width, height } = sourceSize(img);
  if (Math.max(width, height) < UPSCALE_MIN) {
    stage3.push({ make: () => upscaleCanvas(img), engines: 'both' });
  }

  for (const step of stage3) {
    if (Date.now() > deadline) break;
    await yieldToUi();
    const hit = await tryDecodeCanvas(step.make(), reader, readWasm, step.engines, expectedFormat);
    if (hit) return hit;
  }

  throw new Error('not found');
}

function mapZxingFormat(format: BarcodeFormat): string {
  switch (format) {
    case BarcodeFormat.CODE_128:
      return 'CODE128';
    case BarcodeFormat.CODE_39:
      return 'CODE39';
    case BarcodeFormat.EAN_13:
      return 'EAN13';
    case BarcodeFormat.EAN_8:
      return 'EAN8';
    case BarcodeFormat.UPC_A:
      return 'UPC';
    case BarcodeFormat.ITF:
      return 'ITF';
    case BarcodeFormat.CODABAR:
      return 'codabar';
    default:
      return 'CODE128';
  }
}

function sanitizeFilenamePart(value: string): string {
  return value.trim().replace(/[/:]/g, '-').replace(/\s+/g, '_').replace(/[^0-9A-Za-z._-]/g, '');
}

function filenameDate(dateTime: string): string {
  const fromField = sanitizeFilenamePart(dateTime);
  if (fromField) return fromField;
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

type DrawSettings = {
  moduleWidth: number;
  barHeight: number;
  quietMargin: number;
  length: number;
  height: number;
  stretch: boolean;
  numberSize: number;
  dateSize: number;
  barcodeY: number;
};

const DEFAULT_DRAW: DrawSettings = {
  moduleWidth: 2.5,
  barHeight: 450,
  quietMargin: 12,
  length: 920,
  height: 450,
  stretch: true,
  numberSize: 40,
  dateSize: 28,
  barcodeY: 380,
};

const DRAW_SIZE_STORAGE_KEY = 'simpletools.barcode.drawSize';
const BARCODE_SIZE_STEP = 50;

function parseBarcodeSize(value: number) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

function loadStoredDrawSize(): Pick<DrawSettings, 'length' | 'height'> | null {
  try {
    const raw = localStorage.getItem(DRAW_SIZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { length?: unknown; height?: unknown };
    if (typeof parsed.length !== 'number' || typeof parsed.height !== 'number') return null;
    const length = parseBarcodeSize(parsed.length);
    const height = parseBarcodeSize(parsed.height);
    if (length === null || height === null) return null;
    return { length, height };
  } catch {
    return null;
  }
}

function initialDrawSettings(): DrawSettings {
  const stored = loadStoredDrawSize();
  if (!stored) return DEFAULT_DRAW;
  return { ...DEFAULT_DRAW, ...stored, stretch: true };
}

type BarPosition = {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
};

function thresholdFromValues(values: ArrayLike<number>): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) {
    hist[Math.max(0, Math.min(255, Math.round(values[i])))] += 1;
  }
  return otsuThreshold(hist, values.length);
}

function median3Bits(bits: Uint8Array): Uint8Array {
  const out = new Uint8Array(bits.length);
  out[0] = bits[0];
  out[bits.length - 1] = bits[bits.length - 1];
  for (let i = 1; i < bits.length - 1; i++) {
    const a = bits[i - 1];
    const b = bits[i];
    const c = bits[i + 1];
    out[i] = a + b + c >= 2 ? 1 : 0;
  }
  return out;
}

function trimBarBits(bits: Uint8Array): Uint8Array | null {
  let start = 0;
  let end = bits.length - 1;
  while (start < bits.length && bits[start] === 1) start += 1;
  while (end >= start && bits[end] === 1) end -= 1;
  if (end - start < 24) return null;
  let transitions = 0;
  for (let i = start + 1; i <= end; i++) {
    if (bits[i] !== bits[i - 1]) transitions += 1;
  }
  if (transitions < 20) return null;
  return bits.subarray(start, end + 1);
}

function bitsFromValues(values: number[]): Uint8Array | null {
  if (values.length < 24) return null;
  const threshold = thresholdFromValues(values);
  const raw = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    raw[i] = values[i] < threshold ? 0 : 1;
  }
  return trimBarBits(median3Bits(raw));
}

function extractBarBits(canvas: HTMLCanvasElement, position?: BarPosition): Uint8Array | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;

  if (position) {
    const left = {
      x: (position.topLeft.x + position.bottomLeft.x) / 2,
      y: position.topLeft.y + (position.bottomLeft.y - position.topLeft.y) * 0.28,
    };
    const right = {
      x: (position.topRight.x + position.bottomRight.x) / 2,
      y: position.topRight.y + (position.bottomRight.y - position.topRight.y) * 0.28,
    };
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const len = Math.hypot(dx, dy);
    if (len < 24) return null;
    const nx = len ? -dy / len : 0;
    const ny = len ? dx / len : 0;
    const n = Math.max(64, Math.round(len));
    const values = new Array<number>(n);
    const img = ctx.getImageData(0, 0, width, height).data;
    const sample = (x: number, y: number) => {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) return -1;
      const i = (iy * width + ix) * 4;
      return (img[i] * 3 + img[i + 1] * 6 + img[i + 2]) / 10;
    };
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      let sum = 0;
      let count = 0;
      for (const off of [-8, -4, 0, 4, 8]) {
        const lum = sample(left.x + dx * t + nx * off, left.y + dy * t + ny * off);
        if (lum >= 0) {
          sum += lum;
          count += 1;
        }
      }
      values[i] = count ? sum / count : 255;
    }
    return bitsFromValues(values);
  }

  const img = ctx.getImageData(0, 0, width, height);
  const scores = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) {
    let prev = 255;
    let transitions = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (img.data[i] * 3 + img.data[i + 1] * 6 + img.data[i + 2]) / 10;
      if ((lum < 140) !== (prev < 140)) transitions += 1;
      prev = lum;
    }
    scores[y] = transitions;
  }
  let bestY = 0;
  let best = -1;
  for (let y = 0; y < height; y++) {
    if (scores[y] > best) {
      best = scores[y];
      bestY = y;
    }
  }
  if (best < 20) return null;
  let y0 = bestY;
  let y1 = bestY;
  while (y0 > 0 && scores[y0] > best * 0.45) y0 -= 1;
  while (y1 < height - 1 && scores[y1] > best * 0.45) y1 += 1;
  const values = new Array<number>(width).fill(0);
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      values[x] += (img.data[i] * 3 + img.data[i + 1] * 6 + img.data[i + 2]) / 10;
    }
  }
  const rows = y1 - y0 + 1;
  for (let x = 0; x < width; x++) values[x] /= rows;
  return bitsFromValues(values);
}

async function barsFromSource(url: string): Promise<Uint8Array | null> {
  const img = await loadImage(url);
  const canvas = imageToCanvas(img, DECODE_MAX);
  const readWasm = await getWasmRead();
  const imageData = canvasImageData(canvas);
  if (readWasm && imageData) {
    try {
      const results = await readWasm(imageData, {
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        maxNumberOfSymbols: 1,
      });
      const hit = results.find((result) => result.isValid);
      const bits = extractBarBits(canvas, hit?.position);
      if (bits) return bits;
    } catch {
      // fall through
    }
  }
  return extractBarBits(canvas);
}

function canvasFromBarBits(bits: Uint8Array, draw: DrawSettings): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const pad = draw.quietMargin;
  canvas.width = Math.max(1, Math.round(bits.length * draw.moduleWidth + pad * 2));
  canvas.height = draw.barHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === 0) {
      ctx.fillRect(pad + i * draw.moduleWidth, 0, draw.moduleWidth, draw.barHeight);
    }
  }
  return canvas;
}

async function encodeBarcodeCanvas(
  value: string,
  format: string,
  draw: DrawSettings,
): Promise<HTMLCanvasElement | null> {
  const wasmFormat = writerFormat(format);
  if (wasmFormat) {
    const write = await getWasmWrite();
    if (write) {
      try {
        const out = await write(value, {
          format: wasmFormat,
          scale: 1,
          addHRT: false,
          addQuietZones: false,
        });
        if (!out.error && out.symbol.width > 0) {
          const row = out.symbol.data.subarray(0, out.symbol.width);
          const canvas = document.createElement('canvas');
          const pad = draw.quietMargin;
          canvas.width = Math.max(1, Math.round(out.symbol.width * draw.moduleWidth + pad * 2));
          canvas.height = draw.barHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#000000';
          for (let i = 0; i < row.length; i++) {
            if (row[i] < 128) {
              ctx.fillRect(pad + i * draw.moduleWidth, 0, draw.moduleWidth, draw.barHeight);
            }
          }
          return canvas;
        }
      } catch {
        // fall through to JsBarcode
      }
    }
  }

  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, value, {
      format,
      displayValue: false,
      margin: draw.quietMargin,
      background: '#ffffff',
      lineColor: '#000000',
      width: draw.moduleWidth,
      height: draw.barHeight,
    });
    return canvas;
  } catch {
    return null;
  }
}

async function drawTicket(
  dest: HTMLCanvasElement,
  dateTime: string,
  code: string,
  format: string,
  draw: DrawSettings,
  sourceUrl?: string | null,
  copyBars = true,
): Promise<boolean> {
  dest.width = CANVAS_SIZE;
  dest.height = CANVAS_SIZE;
  const ctx = dest.getContext('2d');
  if (!ctx) return false;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (dateTime.trim()) {
    ctx.fillStyle = '#333333';
    ctx.font = `400 ${draw.dateSize}px "Hanken Grotesk", ui-sans-serif, sans-serif`;
    ctx.fillText(dateTime.trim(), CANVAS_SIZE / 2, Math.max(40, draw.barcodeY - 100), 860);
  }

  const value = barcodePayload(code);
  if (!value) return true;

  let barcodeCanvas: HTMLCanvasElement | null = null;
  if (copyBars && sourceUrl) {
    try {
      const bits = await barsFromSource(sourceUrl);
      if (bits) barcodeCanvas = canvasFromBarBits(bits, draw);
    } catch {
      barcodeCanvas = null;
    }
  }
  if (!barcodeCanvas) {
    barcodeCanvas = await encodeBarcodeCanvas(value, format, draw);
  }
  if (!barcodeCanvas) return false;

  // Always stretch to the configured width × height so the printed
  // aspect ratio matches what the ticket reader expects.
  const dw = draw.length;
  const dh = draw.height;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(barcodeCanvas, (CANVAS_SIZE - dw) / 2, draw.barcodeY, dw, dh);
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = '#111111';
  ctx.font = `500 ${draw.numberSize}px "Hanken Grotesk", ui-sans-serif, sans-serif`;
  ctx.fillText(displayCode(value), CANVAS_SIZE / 2, draw.barcodeY + dh + draw.numberSize + 22, 920);
  return true;
}

function SizeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const stepButtonClass =
    'cursor-pointer inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ed-surface text-lg font-semibold text-ed-ink ring-1 ring-ed-line transition duration-200 hover:-translate-y-0.5 hover:bg-ed-band active:scale-[0.98]';

  return (
    <div>
      <label className={pageLabelClass} htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={stepButtonClass}
          aria-label={`Decrease ${label} by ${BARCODE_SIZE_STEP}`}
          onClick={() => onChange(value - BARCODE_SIZE_STEP)}
        >
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          step={BARCODE_SIZE_STEP}
          value={value}
          onChange={(e) => {
            const next = parseBarcodeSize(Number(e.target.value));
            if (next === null) return;
            onChange(next);
          }}
          className={`${pageInputClass} cursor-text [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
        />
        <button
          type="button"
          className={stepButtonClass}
          aria-label={`Increase ${label} by ${BARCODE_SIZE_STEP}`}
          onClick={() => onChange(value + BARCODE_SIZE_STEP)}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function BarcodeCleaner() {
  const { format: formatParam, read: readParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const formatIsRead = Boolean(parseReadParam(formatParam) && !readParam);
  const routeRead: ReadMode = formatIsRead
    ? (parseReadParam(formatParam) ?? 'barcode')
    : (parseReadParam(readParam) ?? 'barcode');
  const routeFormat = formatIsRead ? DEFAULT_FORMAT : (parseFormatParam(formatParam) ?? DEFAULT_FORMAT);

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraBoxRef = useRef<HTMLDivElement>(null);
  const ocrWorkerRef = useRef<OcrWorker | null>(null);
  const autoStartedRef = useRef(false);
  const liveBusyRef = useRef(false);

  const [isPhone, setIsPhone] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [dateTime, setDateTime] = useState('');
  const [code, setCode] = useState('');
  const [format, setFormat] = useState<string>(routeFormat);
  const [outputFormat] = useState<OutputFormatValue>(DEFAULT_OUTPUT_FORMAT);
  const [outputError, setOutputError] = useState('');
  const [draw, setDraw] = useState<DrawSettings>(initialDrawSettings);
  const [copyBars] = useState(true);
  const [readMode, setReadMode] = useState<ReadMode>(routeRead);
  const [status, setStatus] = useState<'idle' | 'reading' | 'ok' | 'manual'>('idle');
  const [readingHint, setReadingHint] = useState('');
  const [error, setError] = useState('');

  const getOcrWorker = useCallback(async () => {
    if (!ocrWorkerRef.current) {
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: PSM.AUTO,
      });
      ocrWorkerRef.current = worker;
    }
    return ocrWorkerRef.current;
  }, []);

  useEffect(() => {
    return () => {
      void ocrWorkerRef.current?.terminate();
      ocrWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const phone = isPhoneDevice();
    setIsPhone(phone);
    if (phone && !autoStartedRef.current) {
      autoStartedRef.current = true;
      setScanning(true);
    }
  }, []);

  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    const stopVideo = () => {
      const stream = video.srcObject;
      if (stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
      }
    };

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
      } catch {
        if (cancelled) return;
        setScanning(false);
        setError('Could not open the camera. Allow camera access and try again.');
      }
    })();

    return () => {
      cancelled = true;
      stopVideo();
    };
  }, [scanning]);

  useEffect(() => {
    setFormat(routeFormat);
    setReadMode(routeRead);
    const canonical = scanPath(routeFormat, routeRead);
    if (location.pathname !== canonical) {
      navigate(canonical, { replace: true });
    }
  }, [location.pathname, navigate, routeFormat, routeRead]);

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

  useEffect(() => {
    try {
      localStorage.setItem(
        DRAW_SIZE_STORAGE_KEY,
        JSON.stringify({ length: draw.length, height: draw.height }),
      );
    } catch {
      // Ignore quota / private-mode failures.
    }
  }, [draw.length, draw.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    void (async () => {
      const ok = await drawTicket(canvas, dateTime, code, outputFormat, draw, sourceUrl, copyBars);
      if (cancelled) return;
      setOutputError(
        ok || !barcodePayload(code)
          ? ''
          : `This number cannot be drawn as ${outputFormat}. Pick another format.`,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [dateTime, code, outputFormat, draw, sourceUrl, copyBars]);

  const finishRead = useCallback((value: string, nextFormat?: string) => {
    setCode(value);
    if (nextFormat) setFormat(nextFormat);
    setStatus('ok');
    setDateTime((prev) => prev || nowTicketDate());
    setError('');
    window.setTimeout(() => {
      canvasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }, []);

  const failRead = useCallback(() => {
    setStatus('manual');
    setError(
      readMode === 'numbers'
        ? 'Could not read the numbers. Type the number below.'
        : 'Could not read the barcode. Type the number below.',
    );
  }, [readMode]);

  useEffect(() => {
    if (!scanning) return;

    let cancelled = false;
    let variantIndex = 0;
    const reader = createReader(format);
    const delay = readMode === 'numbers' ? LIVE_NUMBERS_MS : LIVE_BARCODE_MS;

    const tick = async () => {
      if (cancelled || liveBusyRef.current) return;
      const video = videoRef.current;
      const box = cameraBoxRef.current;
      if (!video || video.readyState < 2) return;

      liveBusyRef.current = true;
      try {
        if (readMode === 'numbers') {
          const crop = box
            ? cropGuideFromVideo(video, box, NUMBER_GUIDE_WIDTH, NUMBER_GUIDE_HEIGHT)
            : snapshotVideo(video);
          if (!crop) return;
          const worker = await getOcrWorker();
          if (cancelled) return;
          await worker.setParameters({
            tessedit_char_whitelist: '0123456789',
            tessedit_pageseg_mode: variantIndex % 2 === 0 ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK,
          });
          const source = variantIndex % 3 === 2 ? contrastCanvas(crop, 2.2, VARIANT_MAX) : crop;
          const { data } = await worker.recognize(source);
          if (cancelled) return;
          const digits = extractDigits(data.text);
          if (digits.length >= OCR_MIN_DIGITS) {
            finishRead(digits);
            setScanning(false);
            return;
          }
        } else {
          const frame = snapshotVideo(video);
          if (!frame) return;
          const readWasm = await getWasmRead();
          if (cancelled) return;
          const hit = await decodeLiveFrame(frame, reader, readWasm, variantIndex, format);
          if (cancelled) return;
          if (hit) {
            frame.toBlob((blob) => {
              if (blob) {
                setSourceUrl((prev) => {
                  if (prev) URL.revokeObjectURL(prev);
                  return URL.createObjectURL(blob);
                });
              }
              finishRead(hit.text);
              setScanning(false);
            }, 'image/jpeg', 0.92);
            return;
          }
        }
        variantIndex += 1;
      } catch {
        // Keep the camera open and try the next frame.
      } finally {
        liveBusyRef.current = false;
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, delay);
    void tick();

    return () => {
      cancelled = true;
      window.clearInterval(id);
      liveBusyRef.current = false;
    };
  }, [finishRead, format, getOcrWorker, readMode, scanning]);

  const decodeImage = useCallback(async (url: string) => {
    setStatus('reading');
    setError('');
    setReadingHint(readMode === 'numbers' ? 'Reading numbers…' : 'Reading barcode…');
    try {
      if (readMode === 'numbers') {
        const img = await loadImage(url);
        const worker = await getOcrWorker();
        const full = imageToCanvas(img);
        const sources = [full, contrastCanvas(img, 1.6), contrastCanvas(img, 2.4), contrastCanvas(img, 3.2)];
        const modes = [PSM.AUTO, PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK];
        const samples: string[] = [];
        for (const mode of modes) {
          await worker.setParameters({
            tessedit_char_whitelist: '0123456789',
            tessedit_pageseg_mode: mode,
          });
          for (const source of sources) {
            const { data } = await worker.recognize(source);
            samples.push(extractDigits(data.text));
          }
        }
        const digits = pickBestDigits(samples);
        if (digits.length < OCR_MIN_DIGITS) throw new Error('not found');
        finishRead(digits);
      } else {
        const result = await decodeBarcode(url, format, setReadingHint);
        finishRead(result.text);
      }
    } catch {
      failRead();
    }
  }, [failRead, finishRead, format, getOcrWorker, readMode]);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      const url = URL.createObjectURL(file);
      setSourceUrl(url);
      void decodeImage(url);
    },
    [decodeImage, sourceUrl],
  );

  const onFileChange = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (file) handleFile(file);
    input.value = '';
  };

  const saveJpg = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !code.trim()) return;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.95);
    });
    if (!blob) return;

    const number = sanitizeFilenamePart(code) || 'code';
    const filename = `BarCode_${number}_${filenameDate(dateTime)}.jpg`;
    const file = new File([blob], filename, { type: 'image/jpeg' });

    try {
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const saveButtonLabel = isPhone ? 'Save to Photos' : 'Download JPG';
  const SaveButtonIcon = isPhone ? PhotoIcon : ArrowDownTrayIcon;

  const clearPhoto = () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(null);
    setCode('');
    setStatus('idle');
    setError('');
    if (galleryInputRef.current) galleryInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
    setScanning(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={pageTitleClass}>Barcode cleaner</h1>
          <p className={pageSubtitleClass}>
            {isPhone
              ? readMode === 'numbers'
                ? 'Line the printed number up in the box. The camera keeps trying until it reads it.'
                : 'Point the camera at the barcode. It keeps trying until it reads it.'
              : 'Upload a photo of a ticket. Get a clean square JPG with the barcode drawn at your width × height.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void saveJpg()}
          disabled={!code.trim()}
          className={pagePrimaryButtonClass}
        >
          <SaveButtonIcon className="h-5 w-5" />
          {saveButtonLabel}
        </button>
      </div>

      <section className={pageCardClass}>
        <h2 className="text-xl font-semibold text-ed-ink mb-4 flex items-center gap-2">
          {isPhone ? <CameraIcon className="h-5 w-5" /> : <ArrowUpTrayIcon className="h-5 w-5" />}
          {isPhone ? 'Scan' : 'Photo'}
        </h2>

        {isPhone ? (
          scanning ? (
            <div ref={cameraBoxRef} className="relative overflow-hidden rounded-[20px] bg-black aspect-square">
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                playsInline
                muted
                autoPlay
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className="ring-2 ring-white shadow-[0_0_0_9999px_rgba(0,0,0,0.48)]"
                  style={{
                    width: `${(readMode === 'numbers' ? NUMBER_GUIDE_WIDTH : SQUARE_GUIDE) * 100}%`,
                    height: `${(readMode === 'numbers' ? NUMBER_GUIDE_HEIGHT : SQUARE_GUIDE) * 100}%`,
                    borderRadius: readMode === 'numbers' ? '8px' : '20px',
                  }}
                />
              </div>
              <p className="pointer-events-none absolute top-4 inset-x-14 text-center text-xs font-medium text-white drop-shadow">
                {readMode === 'numbers'
                  ? 'Keep the number in the box — still trying…'
                  : `Only reading ${format} — still trying…`}
              </p>
              <button
                type="button"
                className="cursor-pointer absolute top-3 right-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white"
                onClick={() => setScanning(false)}
                aria-label="Close camera"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
              <select
                value={format}
                onChange={(e) => navigate(scanPath(e.target.value, readMode), { replace: true })}
                aria-label="Barcode format"
                className="cursor-pointer absolute bottom-4 left-4 right-4 z-10 h-11 rounded-full bg-black/70 px-4 text-sm font-semibold text-white ring-1 ring-white/50"
              >
                {FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <label className={`${pageLabelClass} self-start`}>Scan as</label>
              <select
                value={format}
                onChange={(e) => navigate(scanPath(e.target.value, readMode), { replace: true })}
                className={`${pageInputClass} cursor-pointer`}
              >
                {FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="cursor-pointer w-full aspect-square max-h-[420px] rounded-[20px] bg-ed-ink text-ed-ink-fg flex flex-col items-center justify-center gap-3 px-6"
                onClick={() => {
                  setError('');
                  setScanning(true);
                }}
              >
                <CameraIcon className="h-10 w-10" />
                <span className="text-lg font-semibold">Tap to scan</span>
                <span className="text-sm text-ed-ink-fg/70">
                  {readMode === 'numbers'
                    ? 'Line up the printed number. The camera keeps trying.'
                    : 'Point at the barcode. The camera keeps trying.'}
                </span>
              </button>
              <button
                type="button"
                className={pageSecondaryButtonClass}
                onClick={() => galleryInputRef.current?.click()}
              >
                <PhotoIcon className="h-5 w-5" />
                Choose from photos
              </button>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFileChange(e.currentTarget)}
              />
              {sourceUrl && (
                <img
                  src={sourceUrl}
                  alt="Captured ticket"
                  className="h-40 w-40 object-cover rounded-[20px] ring-1 ring-ed-line"
                />
              )}
              {status === 'reading' && (
                <p className="text-sm text-ed-muted">
                  {readingHint || (readMode === 'numbers' ? 'Reading numbers…' : 'Reading barcode…')}
                </p>
              )}
              {error && <p className="text-sm text-danger-600">{error}</p>}
              {status === 'ok' && code && (
                <p className="text-sm font-medium text-ed-accent">Barcode read: {code}</p>
              )}
              {sourceUrl && (
                <button type="button" className={pageSecondaryButtonClass} onClick={clearPhoto}>
                  Clear photo
                </button>
              )}
            </div>
          )
        ) : (
          <>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleFile(file);
              }}
              className="cursor-pointer border-2 border-dashed border-ed-line rounded-[20px] p-8 text-center hover:border-ed-accent hover:bg-ed-band transition-colors"
            >
              <PhotoIcon className="h-12 w-12 mx-auto mb-3 text-ed-muted" />
              <p className="text-sm font-medium text-ed-ink">Upload an image</p>
              <p className="text-xs text-ed-muted mt-1">The barcode is read on this device</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFileChange(e.currentTarget)}
              />
            </div>
            {sourceUrl && (
              <div className="mt-4 flex flex-wrap items-start gap-4">
                <img
                  src={sourceUrl}
                  alt="Uploaded ticket"
                  className="h-40 w-40 object-cover rounded-[20px] ring-1 ring-ed-line"
                />
                <div className="text-sm">
                  {status === 'reading' && (
                    <p className="text-ed-muted">
                      {readingHint || (readMode === 'numbers' ? 'Reading numbers…' : 'Reading barcode…')}
                    </p>
                  )}
                  {status === 'ok' && <p className="text-ed-accent font-medium">Barcode read: {code}</p>}
                  {status === 'manual' && <p className="text-danger-600">{error}</p>}
                  <button
                    type="button"
                    className={`${pageSecondaryButtonClass} mt-3`}
                    onClick={clearPhoto}
                  >
                    Clear photo
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className={pageCardClass}>
        <h2 className="text-xl font-semibold text-ed-ink mb-4">Ticket text</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={pageLabelClass}>Date / time</label>
            <input
              type="text"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              placeholder="26-08-23 13:15"
              className={pageInputClass}
            />
          </div>
          <div className="md:col-span-2">
            <label className={pageLabelClass}>Read</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={pageChoiceCardClass(readMode === 'barcode')}
                onClick={() => navigate(scanPath(format, 'barcode'), { replace: true })}
              >
                Barcode
              </button>
              <button
                type="button"
                className={pageChoiceCardClass(readMode === 'numbers')}
                onClick={() => navigate(scanPath(format, 'numbers'), { replace: true })}
              >
                Numbers
              </button>
            </div>
          </div>
          <div>
            <label className={pageLabelClass}>Scan as</label>
            <select
              value={format}
              onChange={(e) => navigate(scanPath(e.target.value, readMode), { replace: true })}
              className={`${pageInputClass} cursor-pointer`}
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={pageLabelClass}>Code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (e.target.value) setStatus((s) => (s === 'idle' ? 'manual' : s));
              }}
              placeholder="555080102"
              className={pageInputClass}
            />
            {barcodePayload(code) !== barcodePayload(code).trim() && (
              <p className="mt-2 text-xs text-ed-muted">
                Spaces are part of the barcode. Encoding {JSON.stringify(barcodePayload(code))}.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className={pageCardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-xl font-semibold text-ed-ink">Clean image</h2>
          <button
            type="button"
            onClick={() => void saveJpg()}
            disabled={!code.trim()}
            className={pagePrimaryButtonClass}
          >
            <SaveButtonIcon className="h-5 w-5" />
            {saveButtonLabel}
          </button>
        </div>
        {/*
        <div className="mb-4">
          <button
            type="button"
            className={`${pageChoiceCardClass(copyBars)} mb-3`}
            onClick={() => setCopyBars((v) => !v)}
          >
            Copy bars from photo {copyBars ? 'on' : 'off'}
          </button>
          <label className={pageLabelClass}>Draw as</label>
          <div className="grid grid-cols-2 gap-2">
            {OUTPUT_FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={pageChoiceCardClass(outputFormat === opt.value)}
                onClick={() => setOutputFormat(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        */}
        {outputError && <p className="mb-4 text-sm text-red-600">{outputError}</p>}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SizeField
            id="barcode-width"
            label="Width (px)"
            value={draw.length}
            onChange={(length) => setDraw((d) => ({ ...d, length, stretch: true }))}
          />
          <SizeField
            id="barcode-height"
            label="Height (px)"
            value={draw.height}
            onChange={(height) => setDraw((d) => ({ ...d, height, stretch: true }))}
          />
          <p className="sm:col-span-2 text-sm text-ed-muted">
            Aspect ratio {draw.length} × {draw.height} →{' '}
            {(draw.length / Math.max(1, draw.height)).toFixed(2)} : 1. The barcode is stretched to
            this box.
          </p>
          <button
            type="button"
            className={pageSecondaryButtonClass}
            onClick={() =>
              setDraw((d) => ({
                ...d,
                length: DEFAULT_DRAW.length,
                height: DEFAULT_DRAW.height,
                stretch: true,
              }))
            }
          >
            Reset size
          </button>
        </div>
        {/*
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SliderRow
            label="Bar thickness"
            value={draw.moduleWidth}
            min={1}
            max={8}
            step={0.5}
            onChange={(moduleWidth) => setDraw((d) => ({ ...d, moduleWidth }))}
          />
          <SliderRow
            label="Bar height"
            value={draw.barHeight}
            min={40}
            max={600}
            onChange={(barHeight) => setDraw((d) => ({ ...d, barHeight }))}
          />
          <SliderRow
            label="Length"
            value={draw.length}
            min={200}
            max={980}
            onChange={(length) => setDraw((d) => ({ ...d, length }))}
          />
          <SliderRow
            label="Box height"
            value={draw.height}
            min={40}
            max={600}
            onChange={(height) => setDraw((d) => ({ ...d, height }))}
          />
          <SliderRow
            label="Quiet zone"
            value={draw.quietMargin}
            min={0}
            max={80}
            onChange={(quietMargin) => setDraw((d) => ({ ...d, quietMargin }))}
          />
          <SliderRow
            label="Vertical position"
            value={draw.barcodeY}
            min={80}
            max={700}
            onChange={(barcodeY) => setDraw((d) => ({ ...d, barcodeY }))}
          />
          <SliderRow
            label="Number size"
            value={draw.numberSize}
            min={12}
            max={72}
            onChange={(numberSize) => setDraw((d) => ({ ...d, numberSize }))}
          />
          <SliderRow
            label="Date size"
            value={draw.dateSize}
            min={12}
            max={48}
            onChange={(dateSize) => setDraw((d) => ({ ...d, dateSize }))}
          />
          <button
            type="button"
            className={pageChoiceCardClass(draw.stretch)}
            onClick={() => setDraw((d) => ({ ...d, stretch: !d.stretch }))}
          >
            Stretch to fill {draw.stretch ? 'on' : 'off'}
          </button>
          <button type="button" className={pageSecondaryButtonClass} onClick={() => setDraw(DEFAULT_DRAW)}>
            Reset draw
          </button>
        </div>
        */}
        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="w-full max-w-[420px] aspect-square rounded-[20px] ring-1 ring-ed-line bg-white"
          />
        </div>
      </section>
    </div>
  );
}
