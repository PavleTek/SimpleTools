import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';

const NAV = [
  { label: 'Barcode cleaner', path: '/scan' },
  { label: 'Markdown to PDF', path: '/md-to-pdf' },
  { label: 'QR generator', path: '/qr' },
];

const navBase =
  'nav-item-transition flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-full text-sm w-full text-left cursor-pointer';

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ed-muted">
        Tools
      </div>
      {NAV.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path !== '/scan'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `${navBase} ${
              isActive
                ? 'bg-ed-ink text-ed-ink-fg font-semibold'
                : 'text-ed-muted font-medium hover:bg-ed-band'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="inline-flex items-center gap-2.5 cursor-pointer px-1">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ed-accent text-xs font-bold text-white">
        ST
      </span>
      <span className="text-lg font-bold tracking-tight text-ed-ink">SimpleTools</span>
    </Link>
  );
}

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-screen bg-ed-paper overflow-hidden">
      <aside className="hidden lg:block shrink-0 h-screen min-h-0 overflow-x-hidden overflow-y-auto w-[280px] min-w-[280px] bg-ed-surface border-r border-ed-line p-4">
        <div className="mb-6 px-1">
          <Brand />
        </div>
        <NavItems />
      </aside>

      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-ed-ink/30 cursor-pointer"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative z-10 w-[280px] min-w-[280px] h-full bg-ed-surface border-r border-ed-line p-4 overflow-y-auto">
            <div className="mb-6 flex items-center justify-between px-1">
              <Brand />
              <button
                type="button"
                className="cursor-pointer rounded-full p-2 text-ed-muted hover:bg-ed-band"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <NavItems onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        <header className="lg:hidden sticky top-0 z-40 border-b border-ed-line bg-ed-surface/80 backdrop-blur-sm shrink-0">
          <div className="flex h-14 items-center justify-between px-4">
            <Brand />
            <button
              type="button"
              className="cursor-pointer rounded-full p-2 text-ed-ink hover:bg-ed-band"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
            >
              <Bars3Icon className="h-6 w-6" />
            </button>
          </div>
        </header>

        <header className="hidden lg:flex sticky top-0 z-30 h-14 shrink-0 items-center border-b border-ed-line bg-ed-surface/80 backdrop-blur-sm px-6">
          <p className="text-sm text-ed-muted">Client-side tools. Nothing is uploaded.</p>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto py-8">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
