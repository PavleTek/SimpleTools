export const pageTitleClass =
  'text-[26px] font-bold tracking-tight text-ed-ink lg:text-[32px]';

export const pageSubtitleClass = 'mt-1 text-sm text-ed-muted';

export const pageCardClass =
  'rounded-[20px] ring-1 ring-ed-line bg-ed-surface p-6';

export const pagePrimaryButtonClass =
  'cursor-pointer inline-flex h-10 items-center gap-2 rounded-full bg-ed-ink px-5 text-sm font-semibold text-ed-ink-fg shadow-none transition duration-200 hover:-translate-y-0.5 hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:active:scale-100';

export const pageSecondaryButtonClass =
  'cursor-pointer inline-flex h-10 items-center gap-2 rounded-full bg-ed-surface px-3.5 text-sm font-semibold text-ed-ink ring-1 ring-ed-line transition duration-200 hover:-translate-y-0.5 hover:bg-ed-band active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:active:scale-100';

export const pageLabelClass =
  'block text-xs font-semibold uppercase tracking-wider text-ed-muted mb-2';

export const pageInputClass =
  'w-full rounded-full min-h-[2.875rem] border-0 bg-ed-band px-4 text-sm text-ed-ink outline-none ring-1 ring-ed-line focus:ring-2 focus:ring-ed-accent';

export const pageTextareaClass =
  'w-full rounded-2xl min-h-[10rem] border-0 bg-ed-band px-4 py-3 text-sm text-ed-ink outline-none ring-1 ring-ed-line focus:ring-2 focus:ring-ed-accent resize-y';

export function pageChoiceCardClass(isActive: boolean): string {
  return `cursor-pointer w-full text-left rounded-[20px] px-4 py-3.5 text-sm font-medium transition duration-200 ${
    isActive
      ? 'bg-ed-accent-soft text-ed-accent ring-2 ring-ed-accent shadow-[0_12px_32px_-20px_rgba(26,24,20,0.28)]'
      : 'bg-ed-surface text-ed-ink ring-1 ring-ed-line hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-28px_rgba(26,24,20,0.28)]'
  }`;
}
