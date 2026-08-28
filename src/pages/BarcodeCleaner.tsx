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
} from '@heroicons/react/24/outline';
import {
  FORMAT_OPTIONS,
  parseFormatParam,
  parseReadParam,
  scanPath,
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

function createReader() {
  const hints = new Map<DecodeHintType, BarcodeFormat[] | boolean>();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
  ]);
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
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function contrastCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  contrast: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const { width, height } = sourceSize(source);
  const scale = Math.min(1, DECODE_MAX / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = `grayscale(1) contrast(${contrast})`;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
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

async function decodeBarcode(url: string) {
  const reader = createReader();
  try {
    return await reader.decodeFromImageUrl(url);
  } catch {
    // Photo tickets are often low-contrast; try processed canvases.
  }
  const img = await loadImage(url);
  const variants = [
    imageToCanvas(img),
    contrastCanvas(img, 1.4),
    contrastCanvas(img, 2),
    contrastCanvas(img, 2.8),
    contrastCanvas(img, 3.6),
  ];
  for (const canvas of variants) {
    try {
      return reader.decodeFromCanvas(canvas);
    } catch {
      // try next
    }
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

function drawTicket(
  dest: HTMLCanvasElement,
  dateTime: string,
  code: string,
  format: string,
) {
  dest.width = CANVAS_SIZE;
  dest.height = CANVAS_SIZE;
  const ctx = dest.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (dateTime.trim()) {
    ctx.fillStyle = '#333333';
    ctx.font = '400 28px "Hanken Grotesk", ui-sans-serif, sans-serif';
    ctx.fillText(dateTime.trim(), CANVAS_SIZE / 2, 280, 860);
  }

  if (!code.trim()) return;

  const barcodeCanvas = document.createElement('canvas');
  const barcodeOptions = {
    displayValue: false,
    margin: 8,
    background: '#ffffff',
    lineColor: '#000000',
    width: 4,
    height: 250,
  };

  try {
    JsBarcode(barcodeCanvas, code.trim(), { ...barcodeOptions, format });
  } catch {
    JsBarcode(barcodeCanvas, code.trim(), { ...barcodeOptions, format: 'CODE128' });
  }

  const maxW = 900;
  const maxH = 320;
  const scale = Math.min(maxW / barcodeCanvas.width, maxH / barcodeCanvas.height);
  const dw = barcodeCanvas.width * scale;
  const dh = barcodeCanvas.height * scale;
  const barcodeY = 340;
  ctx.drawImage(barcodeCanvas, (CANVAS_SIZE - dw) / 2, barcodeY, dw, dh);

  ctx.fillStyle = '#111111';
  ctx.font = '500 40px "Hanken Grotesk", ui-sans-serif, sans-serif';
  ctx.fillText(code.trim().split('').join(' '), CANVAS_SIZE / 2, barcodeY + dh + 62, 920);
}

export default function BarcodeCleaner() {
  const { format: formatParam, read: readParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const formatIsRead = Boolean(parseReadParam(formatParam) && !readParam);
  const routeRead: ReadMode = formatIsRead
    ? (parseReadParam(formatParam) ?? 'barcode')
    : (parseReadParam(readParam) ?? 'barcode');
  const routeFormat = formatIsRead ? 'CODE128' : (parseFormatParam(formatParam) ?? 'CODE128');

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ocrWorkerRef = useRef<OcrWorker | null>(null);

  const [isPhone, setIsPhone] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [dateTime, setDateTime] = useState('');
  const [code, setCode] = useState('');
  const [format, setFormat] = useState<string>(routeFormat);
  const [readMode, setReadMode] = useState<ReadMode>(routeRead);
  const [status, setStatus] = useState<'idle' | 'reading' | 'ok' | 'manual'>('idle');
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
    setIsPhone(isPhoneDevice());
  }, []);

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
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawTicket(canvas, dateTime, code, format);
  }, [dateTime, code, format]);

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

  const decodeImage = useCallback(async (url: string) => {
    setStatus('reading');
    setError('');
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
        const result = await decodeBarcode(url);
        finishRead(result.getText(), mapZxingFormat(result.getBarcodeFormat()));
      }
    } catch {
      failRead();
    }
  }, [failRead, finishRead, getOcrWorker, readMode]);

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
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={pageTitleClass}>Barcode cleaner</h1>
          <p className={pageSubtitleClass}>
            {isPhone
              ? readMode === 'numbers'
                ? 'Take a photo of the printed number with your phone camera. The whole picture is read.'
                : 'Take a photo of the barcode with your phone camera. The whole picture is read.'
              : 'Upload a photo of a ticket. Get a clean square JPG with the same barcode.'}
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
          <div className="flex flex-col items-center gap-3 text-center">
            <button
              type="button"
              className="cursor-pointer w-full aspect-square max-h-[420px] rounded-[20px] bg-ed-ink text-ed-ink-fg flex flex-col items-center justify-center gap-3 px-6"
              onClick={() => {
                setError('');
                cameraInputRef.current?.click();
              }}
            >
              <CameraIcon className="h-10 w-10" />
              <span className="text-lg font-semibold">Take a photo</span>
              <span className="text-sm text-ed-ink-fg/70">
                Opens your phone camera, then reads the whole picture
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
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onFileChange(e.currentTarget)}
            />
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
                {readMode === 'numbers' ? 'Reading numbers…' : 'Reading barcode…'}
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
                      {readMode === 'numbers' ? 'Reading numbers…' : 'Reading barcode…'}
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
            <label className={pageLabelClass}>Barcode format</label>
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
