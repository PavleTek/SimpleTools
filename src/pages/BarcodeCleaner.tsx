import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
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
  FORMAT_OPTIONS,
  formatToZxing,
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
const GUIDE_WIDTH = 0.9;
const GUIDE_HEIGHT = 0.18 * 1.25;
const OCR_MIN_DIGITS = 6;
const OCR_SAMPLE_TARGET = 6;
const OCR_TICK_MS = 450;

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

function createLiveReader(preferredFormat?: string) {
  const hints = new Map<DecodeHintType, BarcodeFormat[] | boolean>();
  const preferred = preferredFormat ? formatToZxing(preferredFormat) : null;
  hints.set(DecodeHintType.POSSIBLE_FORMATS, preferred
    ? [preferred]
    : [
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
      ]);
  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 200,
    delayBetweenScanSuccess: 400,
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

function contrastCanvas(img: HTMLImageElement, contrast: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const max = 1600;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.filter = `grayscale(1) contrast(${contrast})`;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropGuideFromVideo(video: HTMLVideoElement, container: HTMLElement): HTMLCanvasElement | null {
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

  const boxW = cw * GUIDE_WIDTH;
  const boxH = ch * GUIDE_HEIGHT;
  const boxX = (cw - boxW) / 2;
  const boxY = (ch - boxH) / 2;

  const sx = (boxX - offX) / scale;
  const sy = (boxY - offY) / scale;
  const sw = boxW / scale;
  const sh = boxH / scale;

  const canvas = document.createElement('canvas');
  const outW = 1200;
  const outH = Math.max(80, Math.round(outW * (sh / sw)));
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.filter = 'grayscale(1) contrast(1.6)';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
  return canvas;
}

function extractDigits(text: string): string {
  // The scan frame is a single number; join digits so spaces/noise do not drop digits.
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
  for (const contrast of [1.4, 2, 2.8]) {
    try {
      return reader.decodeFromCanvas(contrastCanvas(img, contrast));
    } catch {
      // try next contrast
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraBoxRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const ocrWorkerRef = useRef<OcrWorker | null>(null);
  const autoStartedRef = useRef(false);

  const [isPhone, setIsPhone] = useState(false);
  const [scanning, setScanning] = useState(false);
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
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
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

  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let ocrTimer: number | undefined;

    const finishScan = (value: string) => {
      if (cancelled || !value) return;
      cancelled = true;
      setCode(value);
      setStatus('ok');
      setDateTime((prev) => prev || nowTicketDate());
      setError('');
      setScanning(false);
      window.setTimeout(() => {
        canvasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    };

    const stopVideo = () => {
      const stream = video.srcObject;
      if (stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
      }
    };

    if (readMode === 'numbers') {
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
          if (cancelled) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          video.srcObject = stream;
          await video.play();
          const worker = await getOcrWorker();
          const samples: string[] = [];
          const tick = async () => {
            if (cancelled) return;
            const box = cameraBoxRef.current;
            if (box && video.readyState >= 2) {
              const crop = cropGuideFromVideo(video, box);
              if (crop) {
                try {
                  const { data } = await worker.recognize(crop);
                  const digits = extractDigits(data.text);
                  if (digits.length >= OCR_MIN_DIGITS) {
                    samples.push(digits);
                  }
                  if (samples.length >= OCR_SAMPLE_TARGET) {
                    finishScan(pickBestDigits(samples));
                    return;
                  }
                } catch {
                  // keep scanning
                }
              }
            }
            if (!cancelled) ocrTimer = window.setTimeout(() => void tick(), OCR_TICK_MS);
          };
          void tick();
        } catch {
          if (cancelled) return;
          setScanning(false);
          setError('Could not open the camera. Allow camera access and try again.');
        }
      })();

      return () => {
        cancelled = true;
        if (ocrTimer) window.clearTimeout(ocrTimer);
        stopVideo();
      };
    }

    const reader = createLiveReader(format);
    void reader
      .decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        video,
        (result, _err, controls) => {
          if (cancelled || !result) return;
          controls.stop();
          controlsRef.current = null;
          finishScan(result.getText());
        },
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      })
      .catch(() => {
        if (cancelled) return;
        setScanning(false);
        setError('Could not open the camera. Allow camera access and try again.');
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      stopVideo();
    };
  }, [scanning, format, readMode, getOcrWorker]);

  const decodeImage = useCallback(async (url: string) => {
    setStatus('reading');
    setError('');
    try {
      if (readMode === 'numbers') {
        const img = await loadImage(url);
        const worker = await getOcrWorker();
        const samples: string[] = [];
        const { data } = await worker.recognize(img);
        samples.push(extractDigits(data.text));
        for (const contrast of [1.4, 2, 2.8]) {
          const { data: contrasted } = await worker.recognize(contrastCanvas(img, contrast));
          samples.push(extractDigits(contrasted.text));
        }
        const digits = pickBestDigits(samples);
        if (digits.length < OCR_MIN_DIGITS) throw new Error('not found');
        setCode(digits);
      } else {
        const result = await decodeBarcode(url);
        setCode(result.getText());
        setFormat(mapZxingFormat(result.getBarcodeFormat()));
      }
      setStatus('ok');
    } catch {
      setStatus('manual');
      setError(
        readMode === 'numbers'
          ? 'Could not read the numbers. Type the number below.'
          : 'Could not read the barcode. Type the number below.',
      );
    }
  }, [getOcrWorker, readMode]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={pageTitleClass}>Barcode cleaner</h1>
          <p className={pageSubtitleClass}>
            {isPhone
              ? readMode === 'numbers'
                ? 'Point the camera at the printed number. A clean JPG is created as soon as it is read.'
                : 'Point the camera at the barcode. A clean JPG is created as soon as it is read.'
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
                  className="rounded-md ring-2 ring-white shadow-[0_0_0_9999px_rgba(0,0,0,0.48)]"
                  style={{ width: `${GUIDE_WIDTH * 100}%`, height: `${GUIDE_HEIGHT * 100}%` }}
                />
              </div>
              <p className="pointer-events-none absolute bottom-4 inset-x-3 text-center text-xs font-medium text-white drop-shadow">
                {readMode === 'numbers'
                  ? 'Line up the printed number inside the frame'
                  : 'Line up the barcode inside the frame'}
              </p>
              <button
                type="button"
                className="cursor-pointer absolute top-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white"
                onClick={() => setScanning(false)}
                aria-label="Close camera"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <button
                type="button"
                className="cursor-pointer w-full aspect-square max-h-[420px] rounded-[20px] bg-ed-ink text-ed-ink-fg flex flex-col items-center justify-center gap-3 px-6"
                onClick={() => {
                  setError('');
                  setScanning(true);
                }}
              >
                <CameraIcon className="h-10 w-10" />
                <span className="text-lg font-semibold">Tap to start camera</span>
                <span className="text-sm text-ed-ink-fg/70">
                  {readMode === 'numbers'
                    ? 'Line up the printed number inside the frame'
                    : 'Line up the barcode inside the frame'}
                </span>
              </button>
              <button
                type="button"
                className={pageSecondaryButtonClass}
                onClick={() => fileInputRef.current?.click()}
              >
                <PhotoIcon className="h-5 w-5" />
                Choose from photos
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
              {status === 'reading' && (
                <p className="text-sm text-ed-muted">
                  {readMode === 'numbers' ? 'Reading numbers…' : 'Reading barcode…'}
                </p>
              )}
              {error && <p className="text-sm text-danger-600">{error}</p>}
              {status === 'ok' && code && (
                <p className="text-sm font-medium text-ed-accent">Barcode read: {code}</p>
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
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
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
                    onClick={() => {
                      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
                      setSourceUrl(null);
                      setCode('');
                      setStatus('idle');
                      setError('');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
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
