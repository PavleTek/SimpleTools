import type { CSSProperties } from 'react';

export interface ColorSettings {
  h1: string;
  h2: string;
  h3: string;
  body: string;
  link: string;
  codeBg: string;
  codeText: string;
}

export interface ColorPalette {
  name: string;
  colors: ColorSettings;
}

export const COLOR_PALETTES: ColorPalette[] = [
  {
    name: 'Professional',
    colors: {
      h1: '#1a1a2e',
      h2: '#16213e',
      h3: '#0f3460',
      body: '#333333',
      link: '#e94560',
      codeBg: '#f4f4f8',
      codeText: '#e94560',
    },
  },
  {
    name: 'Ocean',
    colors: {
      h1: '#006994',
      h2: '#0d98ba',
      h3: '#40b5ad',
      body: '#2c3e50',
      link: '#1abc9c',
      codeBg: '#ecf0f1',
      codeText: '#2980b9',
    },
  },
  {
    name: 'Forest',
    colors: {
      h1: '#2d6a4f',
      h2: '#40916c',
      h3: '#52b788',
      body: '#1b4332',
      link: '#95d5b2',
      codeBg: '#f0f7f4',
      codeText: '#2d6a4f',
    },
  },
  {
    name: 'Sunset',
    colors: {
      h1: '#9b2226',
      h2: '#bb3e03',
      h3: '#ca6702',
      body: '#3d405b',
      link: '#ee9b00',
      codeBg: '#fff8f0',
      codeText: '#9b2226',
    },
  },
  {
    name: 'Royal',
    colors: {
      h1: '#220070',
      h2: '#3d19a8',
      h3: '#5321e0',
      body: '#2b2d42',
      link: '#7ad9c5',
      codeBg: '#f2e8ff',
      codeText: '#5321e0',
    },
  },
  {
    name: 'Monochrome',
    colors: {
      h1: '#000000',
      h2: '#333333',
      h3: '#555555',
      body: '#444444',
      link: '#0066cc',
      codeBg: '#f5f5f5',
      codeText: '#333333',
    },
  },
];

export const DEFAULT_COLORS: ColorSettings = COLOR_PALETTES[0].colors;

export const FONT_SIZE_OPTIONS = [
  { label: 'Extra Small (8pt)', value: '8pt' },
  { label: 'Small (9pt)', value: '9pt' },
  { label: 'Medium (10pt)', value: '10pt' },
  { label: 'Large (11pt)', value: '11pt' },
  { label: 'Extra Large (12pt)', value: '12pt' },
  { label: 'Huge (14pt)', value: '14pt' },
];

export function getDocumentPreviewCss(colors: ColorSettings): string {
  return `
    .documenta-preview { overflow-wrap: break-word; word-break: break-word; }
    .documenta-preview * { max-width: 100%; box-sizing: border-box; }
    .documenta-preview h1 { color: ${colors.h1}; font-size: 1.75em; font-weight: 700; margin: 0.67em 0; border-bottom: 2px solid ${colors.h1}20; padding-bottom: 0.3em; }
    .documenta-preview h2 { color: ${colors.h2}; font-size: 1.35em; font-weight: 600; margin: 0.83em 0; border-bottom: 1px solid ${colors.h2}15; padding-bottom: 0.25em; }
    .documenta-preview h3 { color: ${colors.h3}; font-size: 1.15em; font-weight: 600; margin: 1em 0; }
    .documenta-preview h4, .documenta-preview h5, .documenta-preview h6 { color: ${colors.h3}; font-weight: 600; margin: 1em 0; }
    .documenta-preview p { color: ${colors.body}; line-height: 1.6; margin: 0.6em 0; }
    .documenta-preview li { color: ${colors.body}; line-height: 1.6; }
    .documenta-preview a { color: ${colors.link}; text-decoration: underline; }
    .documenta-preview code { background-color: ${colors.codeBg}; color: ${colors.codeText}; padding: 0.15em 0.35em; border-radius: 3px; font-size: 0.85em; font-family: 'Courier New', Courier, monospace; }
    .documenta-preview pre { background-color: ${colors.codeBg}; border-radius: 6px; padding: 0.8em; margin: 0.8em 0; border: 1px solid #e0e0e0; white-space: pre-wrap; word-break: break-all; overflow: hidden; }
    .documenta-preview pre code { background: none; padding: 0; color: ${colors.codeText}; white-space: pre-wrap; word-break: break-all; }
    .documenta-preview blockquote { border-left: 4px solid ${colors.h2}; padding-left: 1em; margin: 1em 0; color: ${colors.body}99; font-style: italic; }
    .documenta-preview table { border-collapse: collapse; width: 100%; margin: 0.8em 0; table-layout: fixed; }
    .documenta-preview th { background-color: ${colors.h1}10; color: ${colors.h2}; padding: 0.4em 0.6em; border: 1px solid #ddd; text-align: left; font-weight: 600; font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; word-break: break-word; }
    .documenta-preview td { padding: 0.4em 0.6em; border: 1px solid #ddd; color: ${colors.body}; font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; word-break: break-word; }
    .documenta-preview tr:nth-child(even) { background-color: #f9f9f9; }
    .documenta-preview img { max-width: 100%; height: auto; border-radius: 4px; }
    .documenta-preview hr { border: none; border-top: 2px solid #e0e0e0; margin: 1.5em 0; }
    .documenta-preview ul, .documenta-preview ol { padding-left: 1.5em; margin: 0.6em 0; }
    .documenta-preview strong { font-weight: 700; }
    .documenta-preview em { font-style: italic; }
  `;
}

export const DOCUMENT_PREVIEW_INLINE_STYLE: CSSProperties = {
  width: '8.5in',
  minHeight: '11in',
  margin: '0 auto',
  padding: '0.75in 1in',
  backgroundColor: '#ffffff',
  fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
  lineHeight: '1.5',
  boxSizing: 'border-box',
  overflow: 'hidden',
};
