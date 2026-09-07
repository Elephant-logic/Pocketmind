# PocketMind PWA v0.4

PocketMind is now packaged as an installable Progressive Web App.

## Improvements over v0.3

- Detects and blocks `content://`/download-file launching instead of failing halfway through a model download.
- PWA manifest + service worker + app icons.
- Install-to-home-screen support.
- Offline app-shell caching.
- WebGPU compatibility check.
- Detects `shader-f16`.
- Auto-selects the 360M f16 model when supported, otherwise the compatible f32 version.
- Runs a small Hugging Face/MLC connectivity test before attempting the large model download.
- Better errors for network failure versus GPU-memory failure.
- WebLLM model inference remains local on the device.
- Personal memory remains local and separate from web research history.

See `DEPLOY.md` to put it on HTTPS.

Important: the PWA shell can work offline after installation, but the first model download requires internet.
