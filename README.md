# SimpleTools

Client-only tools website. No login, no backend — files stay in the browser.

## Tools

- **Markdown to PDF** — paste or upload a `.md` file and download a Letter-sized PDF
- **Barcode cleaner** — photograph a ticket and download a clean square JPG

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`). Use plain **http** on localhost — the browser treats that as secure enough for the camera tool.

If you need HTTPS (e.g. testing from a phone on your LAN at `https://192.168.x.x:5173`), run `npm run dev:https` and accept the self-signed certificate warning once in the browser.
