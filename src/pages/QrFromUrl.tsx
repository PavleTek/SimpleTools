import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowDownTrayIcon, QrCodeIcon } from '@heroicons/react/24/outline';
import { FORMAT_OPTIONS, scanUrl, type ReadMode } from '../lib/barcodeFormats';
import {
  pageCardClass,
  pageChoiceCardClass,
  pageInputClass,
  pageLabelClass,
  pagePrimaryButtonClass,
  pageSubtitleClass,
  pageTitleClass,
} from '../lib/pageUi';

const CANVAS_SIZE = 1000;

function sanitizeFilenamePart(value: string): string {
  return value.trim().replace(/[/:]/g, '-').replace(/\s+/g, '_').replace(/[^0-9A-Za-z._-]/g, '');
}

function filenameDate(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

async function drawQr(dest: HTMLCanvasElement, value: string) {
  dest.width = CANVAS_SIZE;
  dest.height = CANVAS_SIZE;
  const ctx = dest.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (!value) return;

  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, value, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 720,
    color: {
      dark: '#111111',
      light: '#ffffff',
    },
  });

  const size = 720;
  const x = (CANVAS_SIZE - size) / 2;
  const y = 100;
  ctx.drawImage(qrCanvas, x, y, size, size);

  ctx.fillStyle = '#333333';
  ctx.font = '400 24px "Hanken Grotesk", ui-sans-serif, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, CANVAS_SIZE / 2, y + size + 56, 860);
}

export default function QrFromUrl() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [format, setFormat] = useState('CODE128');
  const [readMode, setReadMode] = useState<ReadMode>('barcode');
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const encoded = useMemo(
    () => (origin ? scanUrl(format, origin, readMode) : ''),
    [format, origin, readMode],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    void (async () => {
      try {
        await drawQr(canvas, encoded);
        if (!cancelled) setError('');
      } catch {
        if (!cancelled) setError('Could not generate a QR code for this URL.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [encoded]);

  const downloadJpg = () => {
    const canvas = canvasRef.current;
    if (!canvas || !encoded || error) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `QRCode_scan_${sanitizeFilenamePart(format)}_${readMode}_${filenameDate()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      },
      'image/jpeg',
      0.95,
    );
  };

  const canDownload = Boolean(encoded) && !error;
  const onLan = origin.startsWith('https://') || origin.startsWith('http://');
  const looksLocal = /localhost|127\.0\.0\.1/.test(origin);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={pageTitleClass}>QR generator</h1>
          <p className={pageSubtitleClass}>
            Print this QR. Phones that scan it open the barcode cleaner with the camera ready.
          </p>
        </div>
        <button
          type="button"
          onClick={downloadJpg}
          disabled={!canDownload}
          className={pagePrimaryButtonClass}
        >
          <ArrowDownTrayIcon className="h-5 w-5" />
          Download JPG
        </button>
      </div>

      <section className={pageCardClass}>
        <h2 className="text-xl font-semibold text-ed-ink mb-4 flex items-center gap-2">
          <QrCodeIcon className="h-5 w-5" />
          Scanner link
        </h2>
        <div>
          <label className={pageLabelClass}>Barcode format</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFormat(opt.value)}
                className={pageChoiceCardClass(format === opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-5">
          <label className={pageLabelClass}>Read</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={pageChoiceCardClass(readMode === 'barcode')}
              onClick={() => setReadMode('barcode')}
            >
              Barcode
            </button>
            <button
              type="button"
              className={pageChoiceCardClass(readMode === 'numbers')}
              onClick={() => setReadMode('numbers')}
            >
              Numbers
            </button>
          </div>
        </div>
        <div className="mt-5">
          <label className={pageLabelClass} htmlFor="scan-url">
            URL in the QR
          </label>
          <input
            id="scan-url"
            type="text"
            readOnly
            value={encoded}
            className={`${pageInputClass} cursor-text`}
            onFocus={(e) => e.currentTarget.select()}
          />
          {looksLocal && onLan && (
            <p className="mt-2 text-sm text-danger-600">
              This QR uses localhost. Open SimpleTools from your phone IP first, then generate the QR again.
            </p>
          )}
          {error && <p className="mt-2 text-sm text-danger-600">{error}</p>}
        </div>
      </section>

      <section className={pageCardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-xl font-semibold text-ed-ink">Clean image</h2>
          <button
            type="button"
            onClick={downloadJpg}
            disabled={!canDownload}
            className={pagePrimaryButtonClass}
          >
            <ArrowDownTrayIcon className="h-5 w-5" />
            Download JPG
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
