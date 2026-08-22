# Contributing to ClearCut

Thanks for wanting to help improve ClearCut. This project only stays free and
independent of paywalled tools like remove.bg if people pitch in — issues,
bug reports, and PRs are all genuinely welcome.

By participating, you're expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting set up

```bash
git clone https://github.com/Manishkarki1/clearcut-bg-remover.git
cd clearcut-bg-remover
npm install
npm run dev
```

Open the printed local URL. Changes to `src/` hot-reload automatically.

## Project structure

```
index.html      Markup for both screens (upload + editor)
src/main.js      All app logic: upload, AI removal, erase/restore/crop, undo/redo, export
src/style.css    All styling (CSS variables at the top control the theme)
```

There's no framework and no build step beyond Vite — plain DOM APIs and the
Canvas 2D API throughout. Keep it that way unless there's a strong reason to
add a dependency; the whole point of this project is to stay small, fast,
and easy to audit.

## Making a change

1. Fork the repo and create a branch off `main`:
   `git checkout -b fix/short-description`
2. Make your change. Run `npm run build` locally to make sure it compiles
   cleanly before opening a PR.
3. Test manually in the browser — there's no automated test suite yet
   (see "Good first issues" below if you'd like to help add one).
4. Open a pull request describing what changed and why. Screenshots or a
   short screen recording are appreciated for anything UI-related.

## Reporting bugs

Open an issue with:
- What you did
- What you expected to happen
- What actually happened
- Browser + OS, and whether it's reproducible on desktop, mobile, or both

Background-removal quality issues are useful too — a link or attached
example image (nothing private/sensitive) helps a lot.

## Good first issues

- Additional export presets (e.g. common social media sizes)
- Keyboard shortcuts for tool switching (E for erase, R for restore, C for crop)
- A basic automated test setup
- Accessibility passes (focus states, screen-reader labels)
- Self-hosting the AI model's `.wasm`/`.onnx` assets instead of relying on a CDN

## A note on the AGPL license

This project is licensed under AGPL-3.0-or-later (see [LICENSE](LICENSE)),
largely because it depends on `@imgly/background-removal`, which is itself
AGPL-licensed. Contributions are accepted under the same license — by
submitting a PR you agree your contribution can be distributed under
AGPL-3.0-or-later.
