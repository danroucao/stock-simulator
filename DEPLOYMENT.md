# GitHub Pages deployment

The workflow in `.github/workflows/deploy-pages.yml` runs tests, builds the Angular application, and deploys it to GitHub Pages on every push to `main` or `master`. It can also be run manually from the repository's **Actions** tab.

## One-time GitHub setup

1. Push this project, including the `.github/workflows/deploy-pages.yml` file, to the intended repository.
2. Open the repository on GitHub.
3. Go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.
5. Open **Actions → Deploy Angular app to GitHub Pages** and run the workflow, or push a commit to `main`/`master`.

The workflow derives the repository name automatically and builds Angular with the correct `base-href` for:

```text
https://<account>.github.io/<repository>/
```

## Local Git remote

This working copy currently has no `origin` remote. Configure it with the HTTPS or SSH URL shown by the target GitHub repository:

```powershell
git remote add origin https://github.com/<account>/<repository>.git
git push -u origin master
```

If the GitHub default branch is `main`, rename and push it instead:

```powershell
git branch -M main
git push -u origin main
```

Git authentication used by VS Code Source Control does not affect the deployed site. GitHub Actions runs under the repository's automatically provided `GITHUB_TOKEN`.

## TPEx API on GitHub Pages

The Cloudflare Worker in `worker/` is a restricted production proxy for the two TPEx endpoints used by the app. Its CORS policy allows `https://danroucao.github.io` and local Angular development only; it is not an open proxy.

### 1. Deploy the Worker

Create or sign in to a Cloudflare account, then run from the repository root:

```powershell
npx wrangler login
npx wrangler deploy --config worker/wrangler.jsonc
```

Wrangler prints a URL similar to:

```text
https://stock-simulator-tpex-proxy.<cloudflare-subdomain>.workers.dev
```

### 2. Configure the GitHub repository variable

Open the GitHub repository and go to:

```text
Settings → Secrets and variables → Actions → Variables → New repository variable
```

Create:

```text
Name:  TPEX_PROXY_URL
Value: https://stock-simulator-tpex-proxy.<cloudflare-subdomain>.workers.dev
```

Do not append `/api/tpex` or a TPEx endpoint path.

### 3. Deploy GitHub Pages again

Run **Actions → Deploy Angular app to GitHub Pages → Run workflow**, or push a commit to `main`/`master`. The workflow writes the Worker URL to `public/runtime-config.js` before building. Local development keeps using `/api/tpex` through `proxy.conf.json`.

The production site is configured for:

```text
https://danroucao.github.io/stock-simulator/
```
