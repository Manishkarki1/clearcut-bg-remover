# ClearCut — Free, Open-Source Background Remover

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![CI](https://github.com/Manishkarki1/clearcut-bg-remover/actions/workflows/ci.yml/badge.svg)](https://github.com/Manishkarki1/clearcut-bg-remover/actions/workflows/ci.yml)

A self-hosted, high-quality background remover built as an open-source alternative to
paid tools like remove.bg. Everything runs **client-side in the browser** using AI (via
`@imgly/background-removal`, ONNX + WASM) — no server, no per-image cost, and no image
is ever uploaded to a third party.

## Features

- Drag-and-drop or click-to-upload image
- Automatic AI background removal (runs locally in the browser)
- **Erase** brush — manually paint away leftover background bits
- **Restore** brush — paint back parts the AI removed by mistake
- **Crop** tool with a draggable selection and marching-ants outline
- Background swatches (transparent / white / black / custom color) for preview & export
- Undo/redo history (with **Ctrl+Z** / **Ctrl+Y** shortcuts) + "Reset to Original"
- Export as PNG (transparent), JPEG, or WEBP, with a quality slider
- Responsive, touch-friendly layout — works on phones and tablets, not just desktop

## Try it

https://clearcutremover.com

## Run it locally

```bash
git clone https://github.com/Manishkarki1/clearcut-bg-remover.git
cd clearcut-bg-remover
npm install
npm run dev
```

Then open the printed local URL (usually http://localhost:5173).

## Build for production / deploy

```bash
npm run build
```

This outputs a static site into `dist/`. You can deploy that folder as-is to any static
host — Vercel, Netlify, Cloudflare Pages, GitHub Pages, or your own server. No backend needed.
A basic GitHub Actions workflow (`.github/workflows/ci.yml`) already verifies the build on
every push and pull request; wire up your host's own deploy step/integration on top of that.

## License

ClearCut is licensed under the **GNU Affero General Public License v3.0 or later
(AGPL-3.0-or-later)** — see [LICENSE](LICENSE) for the full text.

In short: you're free to use, study, modify, and redistribute this software. If you run a
modified version of it as a network service (e.g. your own hosted fork), AGPL requires that
you also make your modified source code available to the people using it. This matches the
license of `@imgly/background-removal`, the AI library this project depends on for
background removal.

## Contributing

Bug reports, feature requests, and pull requests are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) for how to get set up and what's useful to work on.
Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

## Notes on quality

The AI model runs entirely in-browser via WebAssembly/WebGPU, so quality and speed depend on
the visitor's device. It's genuinely good on clean product/portrait shots. For trickier images
(flyaway hair, semi-transparent objects, busy edges), that's exactly what the Erase/Restore
brushes are for — the same workflow remove.bg's own manual editor uses.

## Tech stack

- Vite (vanilla JS, no framework overhead)
- `@imgly/background-removal` for in-browser AI segmentation
- Plain Canvas 2D API for erase/restore/crop/compositing/export

