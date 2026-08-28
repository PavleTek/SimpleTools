import { BarcodeFormat } from '@zxing/library';

export const FORMAT_OPTIONS = [
  { label: 'CODE128', value: 'CODE128' },
  { label: 'CODE39', value: 'CODE39' },
  { label: 'EAN-13', value: 'EAN13' },
  { label: 'EAN-8', value: 'EAN8' },
  { label: 'UPC', value: 'UPC' },
  { label: 'ITF', value: 'ITF' },
  { label: 'Codabar', value: 'codabar' },
] as const;

export type BarcodeFormatValue = (typeof FORMAT_OPTIONS)[number]['value'];

const ALIASES: Record<string, BarcodeFormatValue> = {
  code128: 'CODE128',
  code39: 'CODE39',
  ean13: 'EAN13',
  'ean-13': 'EAN13',
  ean8: 'EAN8',
  'ean-8': 'EAN8',
  upc: 'UPC',
  upca: 'UPC',
  itf: 'ITF',
  codabar: 'codabar',
};

export function parseFormatParam(raw: string | undefined): BarcodeFormatValue | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key in ALIASES) return ALIASES[key];
  const exact = FORMAT_OPTIONS.find((opt) => opt.value.toLowerCase() === key);
  return exact?.value ?? null;
}

export function formatToZxing(format: string): BarcodeFormat {
  switch (format) {
    case 'CODE39':
      return BarcodeFormat.CODE_39;
    case 'EAN13':
      return BarcodeFormat.EAN_13;
    case 'EAN8':
      return BarcodeFormat.EAN_8;
    case 'UPC':
      return BarcodeFormat.UPC_A;
    case 'ITF':
      return BarcodeFormat.ITF;
    case 'codabar':
      return BarcodeFormat.CODABAR;
    default:
      return BarcodeFormat.CODE_128;
  }
}

export function scanPath(format: string = 'CODE128'): string {
  return `/scan/${format}`;
}

export function scanUrl(format: string = 'CODE128', origin = window.location.origin): string {
  return `${origin}${scanPath(format)}`;
}
