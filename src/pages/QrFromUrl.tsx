import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import {
  pageCardClass,
  pagePrimaryButtonClass,
  pageSubtitleClass,
  pageTextareaClass,
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

function filenameFromText(text: string): string {
  try {
    const host = new URL(text.trim()).hostname.replace(/^www\./, '');
    if (host) return sanitizeFilenamePart(host) || 'text';
  } catch {
    // not a URL
  }
  return sanitizeFilenamePart(text).slice(0, 40) || 'text';
}

async function drawQr(dest: HTMLCanvasElement, value: string) {
  dest.width = CANVAS_SIZE;
  dest.height = CANVAS_SIZE;
  const ctx = dest.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (!value.trim()) return;

  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, value.trim(), {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 860,
    color: {
      dark: '#111111',
      light: '#ffffff',
    },
  });

  const size = 860;
  const xy = (CANVAS_SIZE - size) / 2;
  ctx.drawImage(qrCanvas, xy, xy, size, size);
}

export default function QrFromUrl() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    void (async () => {
      try {
        await drawQr(canvas, text);
        if (!cancelled) setError('');
      } catch {
        if (!cancelled) setError('Could not generate a QR code for this text.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text]);

  const downloadJpg = () => {
    const canvas = canvasRef.current;
    if (!canvas || !text.trim() || error) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `QRCode_${filenameFromText(text)}_${filenameDate()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      },
      'image/jpeg',
      0.95,
    );
  };

  const canDownload = Boolean(text.trim()) && !error;

  return (
    <div className="space-y-6">
      <div>
        <h1 className={pageTitleClass}>QR generator</h1>
        <p className={pageSubtitleClass}>Paste text. Download a square JPG of the QR code.</p>
      </div>

      <section className={pageCardClass}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste text or a URL"
          className={`${pageTextareaClass} min-h-[6rem]`}
          spellCheck={false}
        />
        {error && <p className="mt-2 text-sm text-danger-600">{error}</p>}
      </section>

      <section className={pageCardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-xl font-semibold text-ed-ink">QR</h2>
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
