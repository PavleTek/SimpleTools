import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { marked } from 'marked';
import html2pdf from 'html2pdf.js';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  DocumentTextIcon,
  SwatchIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import {
  COLOR_PALETTES,
  DEFAULT_COLORS,
  DOCUMENT_PREVIEW_INLINE_STYLE,
  FONT_SIZE_OPTIONS,
  getDocumentPreviewCss,
  type ColorPalette,
  type ColorSettings,
} from '../lib/documentStyles';
import {
  pageCardClass,
  pageChoiceCardClass,
  pageInputClass,
  pageLabelClass,
  pagePrimaryButtonClass,
  pageSecondaryButtonClass,
  pageSubtitleClass,
  pageTextareaClass,
  pageTitleClass,
} from '../lib/pageUi';

const COLOR_FIELDS: { key: keyof ColorSettings; label: string; description: string }[] = [
  { key: 'h1', label: 'H1 Titles', description: 'Main headings' },
  { key: 'h2', label: 'H2 Subtitles', description: 'Section headings' },
  { key: 'h3', label: 'H3 Headings', description: 'Sub-section headings' },
  { key: 'body', label: 'Body Text', description: 'Paragraphs & lists' },
  { key: 'link', label: 'Links', description: 'Hyperlinks' },
  { key: 'codeBg', label: 'Code Background', description: 'Code block background' },
  { key: 'codeText', label: 'Code Text', description: 'Code text color' },
];

export default function MdToPdf() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const [markdownContent, setMarkdownContent] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [documentTitle, setDocumentTitle] = useState('document');
  const [colors, setColors] = useState<ColorSettings>(DEFAULT_COLORS);
  const [activePalette, setActivePalette] = useState('Professional');
  const [fontSize, setFontSize] = useState('10pt');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (!markdownContent) {
      setHtmlContent('');
      return;
    }
    const parsed = marked.parse(markdownContent);
    if (typeof parsed === 'string') {
      setHtmlContent(parsed);
    } else {
      void parsed.then((result) => setHtmlContent(result));
    }
  }, [markdownContent]);

  const handleFileRead = useCallback((file: File) => {
    if (!file.name.endsWith('.md') && !file.name.endsWith('.markdown')) {
      return;
    }
    setFileName(file.name);
    setDocumentTitle(file.name.replace(/\.(md|markdown)$/i, ''));
    const reader = new FileReader();
    reader.onload = (e) => {
      setMarkdownContent(String(e.target?.result ?? ''));
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileRead(file);
    },
    [handleFileRead],
  );

  const clearFile = () => {
    setMarkdownContent('');
    setHtmlContent('');
    setFileName('');
    setDocumentTitle('document');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const applyPalette = (palette: ColorPalette) => {
    setColors(palette.colors);
    setActivePalette(palette.name);
  };

  const updateColor = (key: keyof ColorSettings, value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }));
    setActivePalette('');
  };

  const downloadPDF = async () => {
    if (!htmlContent || !previewRef.current) return;
    setIsGenerating(true);
    try {
      const clone = previewRef.current.cloneNode(true) as HTMLElement;
      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.left = '-9999px';
      host.style.top = '0';
      const style = document.createElement('style');
      style.textContent = getDocumentPreviewCss(colors);
      host.appendChild(style);
      host.appendChild(clone);
      document.body.appendChild(host);

      await html2pdf()
        .set({
          margin: 0,
          filename: `${documentTitle || 'document'}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] },
        })
        .from(clone)
        .save();

      document.body.removeChild(host);
    } catch (err) {
      console.error('Error generating PDF:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={pageTitleClass}>Markdown to PDF</h1>
          <p className={pageSubtitleClass}>
            Convert Markdown to a Letter-sized PDF in the browser. Nothing is saved.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void downloadPDF()}
          disabled={isGenerating || !htmlContent}
          className={pagePrimaryButtonClass}
        >
          <ArrowDownTrayIcon className="h-5 w-5" />
          {isGenerating ? 'Generating…' : 'Download PDF'}
        </button>
      </div>

      <section className={pageCardClass}>
        <h2 className="text-xl font-semibold text-ed-ink mb-4 flex items-center gap-2">
          <ArrowUpTrayIcon className="h-5 w-5" />
          Upload or paste
        </h2>

        {!fileName ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragOver(false);
            }}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer border-2 border-dashed rounded-[20px] p-10 text-center transition-all ${
              isDragOver
                ? 'border-ed-accent bg-ed-accent-soft'
                : 'border-ed-line hover:border-ed-accent hover:bg-ed-band'
            }`}
          >
            <DocumentTextIcon
              className={`h-12 w-12 mx-auto mb-3 ${isDragOver ? 'text-ed-accent' : 'text-ed-muted'}`}
            />
            <p className="text-sm font-medium text-ed-ink">
              {isDragOver ? 'Drop your file here' : 'Drag & drop a .md file'}
            </p>
            <p className="text-xs text-ed-muted mt-1">or click to browse</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileRead(file);
              }}
              className="hidden"
            />
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 rounded-[20px] bg-ed-accent-soft ring-1 ring-ed-line">
            <div className="flex items-center gap-3 min-w-0">
              <DocumentTextIcon className="h-8 w-8 text-ed-accent shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-ed-ink truncate">{fileName}</p>
                <p className="text-sm text-ed-muted">{markdownContent.length} characters</p>
              </div>
            </div>
            <button type="button" onClick={clearFile} className={pageSecondaryButtonClass}>
              <TrashIcon className="h-4 w-4" />
              Remove
            </button>
          </div>
        )}

        <div className="mt-5">
          <label className={pageLabelClass}>Or paste Markdown</label>
          <textarea
            value={markdownContent}
            onChange={(e) => {
              setMarkdownContent(e.target.value);
              if (!fileName && e.target.value) setFileName('pasted.md');
            }}
            placeholder="# Heading&#10;&#10;Write or paste markdown here…"
            className={pageTextareaClass}
          />
        </div>
      </section>

      {htmlContent && (
        <>
          <section className={pageCardClass}>
            <h2 className="text-xl font-semibold text-ed-ink mb-4">Document settings</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={pageLabelClass}>Document title</label>
                <input
                  type="text"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  className={pageInputClass}
                />
                <p className="mt-1.5 text-xs text-ed-muted">
                  File name: <strong>{documentTitle || 'document'}.pdf</strong>
                </p>
              </div>
              <div>
                <label className={pageLabelClass}>Font size</label>
                <select
                  value={fontSize}
                  onChange={(e) => setFontSize(e.target.value)}
                  className={`${pageInputClass} cursor-pointer`}
                >
                  {FONT_SIZE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className={pageCardClass}>
            <h2 className="text-xl font-semibold text-ed-ink mb-4 flex items-center gap-2">
              <SwatchIcon className="h-5 w-5" />
              Color settings
            </h2>
            <div className="mb-6">
              <label className={pageLabelClass}>Palettes</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {COLOR_PALETTES.map((palette) => (
                  <button
                    key={palette.name}
                    type="button"
                    onClick={() => applyPalette(palette)}
                    className={pageChoiceCardClass(activePalette === palette.name)}
                  >
                    <div className="flex gap-1 mb-2">
                      {[palette.colors.h1, palette.colors.h2, palette.colors.h3, palette.colors.body].map(
                        (color, i) => (
                          <div
                            key={i}
                            className="w-4 h-4 rounded-full ring-1 ring-ed-line"
                            style={{ backgroundColor: color }}
                          />
                        ),
                      )}
                    </div>
                    <span className="text-xs font-medium">{palette.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={pageLabelClass}>Custom colors</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {COLOR_FIELDS.map((field) => (
                  <div key={field.key} className="flex items-center gap-3 p-3 rounded-2xl bg-ed-band">
                    <input
                      type="color"
                      value={colors[field.key]}
                      onChange={(e) => updateColor(field.key, e.target.value)}
                      className="w-10 h-10 rounded-md cursor-pointer p-0.5 bg-white ring-1 ring-ed-line"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ed-ink">{field.label}</p>
                      <p className="text-xs text-ed-muted truncate">{field.description}</p>
                      <input
                        type="text"
                        value={colors[field.key]}
                        onChange={(e) => updateColor(field.key, e.target.value)}
                        className="mt-1 w-full text-xs px-2 py-1 rounded-full font-mono bg-ed-surface ring-1 ring-ed-line outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className={pageCardClass}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-xl font-semibold text-ed-ink">Preview</h2>
              <button
                type="button"
                onClick={() => void downloadPDF()}
                disabled={isGenerating || !htmlContent}
                className={pagePrimaryButtonClass}
              >
                <ArrowDownTrayIcon className="h-5 w-5" />
                {isGenerating ? 'Generating…' : 'Download PDF'}
              </button>
            </div>
            <div className="ring-1 ring-ed-line rounded-[20px] bg-white overflow-auto" style={{ maxHeight: 800 }}>
              <style>{getDocumentPreviewCss(colors)}</style>
              <div
                ref={previewRef}
                className="documenta-preview"
                style={{ ...DOCUMENT_PREVIEW_INLINE_STYLE, fontSize }}
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
