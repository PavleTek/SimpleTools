import { Link } from 'react-router-dom';
import { DocumentTextIcon, LinkIcon, QrCodeIcon } from '@heroicons/react/24/outline';
import { pageSubtitleClass, pageTitleClass } from '../lib/pageUi';

const TOOLS = [
  {
    to: '/scan',
    title: 'Barcode cleaner',
    description: 'Scan a ticket barcode on your phone and get a clean square JPG — ready to send.',
    icon: QrCodeIcon,
  },
  {
    to: '/md-to-pdf',
    title: 'Markdown to PDF',
    description: 'Paste or upload a .md file and download a Letter-sized PDF. Runs entirely in your browser.',
    icon: DocumentTextIcon,
  },
  {
    to: '/qr',
    title: 'QR generator',
    description: 'Make a QR that opens the barcode scanner with the camera ready.',
    icon: LinkIcon,
  },
];

export default function Home() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className={pageTitleClass}>Tools</h1>
        <p className={pageSubtitleClass}>
          No login. No backend. Files stay on this device.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link
            key={tool.to}
            to={tool.to}
            className="cursor-pointer group rounded-[20px] ring-1 ring-ed-line bg-ed-surface p-6 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-28px_rgba(26,24,20,0.28)]"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-ed-accent-soft text-ed-accent">
              <tool.icon className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-xl font-semibold text-ed-ink">{tool.title}</h2>
            <p className="mt-1.5 text-sm text-ed-muted leading-relaxed">{tool.description}</p>
            <span className="mt-4 inline-flex text-sm font-semibold text-ed-accent group-hover:underline">
              Open
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
