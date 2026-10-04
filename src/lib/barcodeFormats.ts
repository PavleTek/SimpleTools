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

export const DEFAULT_FORMAT: BarcodeFormatValue = 'CODE128';

export const OUTPUT_FORMAT_OPTIONS = [
  { label: 'CODE128 match scan', value: 'CODE128' },
  { label: 'CODE128-A', value: 'CODE128A' },
  { label: 'CODE128-B long', value: 'CODE128B' },
  { label: 'CODE128-C compact', value: 'CODE128C' },
  { label: 'CODE39', value: 'CODE39' },
  { label: 'EAN-13', value: 'EAN13' },
  { label: 'EAN-8', value: 'EAN8' },
  { label: 'UPC', value: 'UPC' },
  { label: 'ITF', value: 'ITF' },
  { label: 'Codabar', value: 'codabar' },
] as const;

export type OutputFormatValue = (typeof OUTPUT_FORMAT_OPTIONS)[number]['value'];

export const DEFAULT_OUTPUT_FORMAT: OutputFormatValue = 'CODE128';

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

export function formatToWasm(
  format: string,
): 'Code39' | 'Code128' | 'EAN13' | 'EAN8' | 'UPCA' | 'ITF' | 'Codabar' {
  switch (format) {
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
      return 'Code128';
  }
}

export const READ_MODES = [
  { label: 'Barcode', value: 'barcode' },
  { label: 'Numbers', value: 'numbers' },
] as const;

export type ReadMode = (typeof READ_MODES)[number]['value'];

export function parseReadParam(raw: string | undefined): ReadMode | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key === 'numbers' || key === 'number' || key === 'ocr' || key === 'digits') return 'numbers';
  if (key === 'barcode' || key === 'bars' || key === 'code') return 'barcode';
  return null;
}

export function scanPath(format: string = DEFAULT_FORMAT, read: ReadMode = 'barcode'): string {
  if (read === 'numbers') return `/scan/${format}/numbers`;
  return `/scan/${format}`;
}

export function scanUrl(
  format: string = DEFAULT_FORMAT,
  origin = window.location.origin,
  read: ReadMode = 'barcode',
): string {
  return `${origin}${scanPath(format, read)}`;
}
