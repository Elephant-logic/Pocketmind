# Put PocketMind v0.4 online (HTTPS)

The important change from the old HTML file is that this version must be served as a website.
Do **not** open `index.html` from Android Downloads (`content://...`).

## Easiest option: GitHub Pages

1. Create a new GitHub repository, for example `pocketmind`.
2. Upload the **contents** of this folder to the repository root.
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, choose **GitHub Actions** if it is not already selected.
5. The included `.github/workflows/pages.yml` workflow will publish the site.
6. Open the HTTPS Pages address GitHub gives you on the phone.
7. In Chrome, use **Install app** / **Add to Home screen** if PocketMind does not show its own Install button.
8. Launch the installed PocketMind icon, run **Run connection test**, then **Load local AI**.

## Other static hosts

The folder also works on Netlify, Cloudflare Pages, Vercel static hosting, or any ordinary HTTPS web server.
No backend is required.

## Why HTTPS matters

Service workers and reliable WebGPU/browser storage features are designed for secure contexts.
`localhost` is accepted for development, but the phone should use HTTPS.

## Model download

PocketMind v0.4 defaults to:
- SmolLM2 360M q4f16 when the GPU exposes `shader-f16`.
- SmolLM2 360M q4f32 otherwise.

The model is downloaded by WebLLM from the MLC/Hugging Face model host and then cached by the browser/WebLLM.
