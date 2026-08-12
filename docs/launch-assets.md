# Launch assets

The repository presentation uses two assets generated from the real `fixtures/demo` change and the asserted outputs created by `scripts/generate-demo.mjs`.

- `assets/proofdiff-launch-demo.gif`: 1200 × 675, approximately 15 seconds, looping. Its diff is derived from the fixture files, its evidence counts and terminal excerpt come from `examples/demo-report.json` and `examples/demo-terminal.txt`, and its report view uses the real `examples/demo-gallery.png` capture.
- `assets/proofdiff-social-preview.png`: 1280 × 640 with a solid background and a small-size-safe value proposition. It is ready for GitHub's repository **Settings → General → Social preview** upload control.

Neither asset invents terminal output, product UI, evidence, adoption, or performance claims. Regenerate the reports first, then opt into the Pillow-based launch render:

```bash
npm run demo
PROOFDIFF_ASSET_PYTHON=/path/to/python-with-pillow node scripts/generate-demo.mjs --launch-assets
```

The social preview follows GitHub's recommended 1280 × 640 size and remains below its 1 MB upload limit.
