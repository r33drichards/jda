# jda

A hello-world Chrome extension that uses TypeSafe Jev to classify the current browser page as **update**, **asking for approval**, **clarifying question**, or **other**. Configure rules as JSON, evaluate once, or run on a periodic loop.

Based on the React/TypeScript/Vite + CRXJS architecture in [yosevu/react-chrome-extension-template](https://github.com/yosevu/react-chrome-extension-template) (source snapshot `1661acbdca3a626f5fb99be0908a3fedf2ba9dd9`). Uses the [official TypeSafe SDK](https://github.com/typesafe-ai/typesafe-sdk-js) and [Playwright's extension testing pattern](https://playwright.dev/docs/chrome-extensions).

## Run locally

Requires Node 24+ and npm 11+.

```sh
npm ci
cp .env.example .env
# Set TYPESAFE_API_KEY in .env to your actual TypeSafe API key.
npm run server
```

In a second terminal:

```sh
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this project's `dist` directory. Open a regular HTTP(S) page and click the jda toolbar icon. Choose **Evaluate current page** to send a page summary to Jev. The local service must stay running.

## Configure rules and monitoring

Open **Settings** in the popup. The configuration contains:

```json
{
  "model": "jev-latest",
  "intervalSeconds": 60,
  "rules": [
    {
      "id": "approval",
      "description": "The main content asks someone to approve, authorize, or confirm a proposed action.",
      "decision": "asking for approval",
      "enabled": true
    },
    {
      "id": "clarify",
      "description": "The main content asks for missing information or clarification needed to proceed.",
      "decision": "clarifying question",
      "enabled": true
    },
    {
      "id": "update",
      "description": "The main content reports progress, status, or completed work without requesting a response.",
      "decision": "update",
      "enabled": true
    }
  ]
}
```

Rule decisions must be exactly `update`, `asking for approval`, `clarifying question`, or `other`. Put higher priority rules first; the model is instructed to favor the first applicable rule and choose `other` when evidence is insufficient. This is a model judgment, not deterministic rule matching. The popup shows its selected choice, confidence, and probabilities. With no enabled rules the service returns `other` without an API call.

Click **Start monitoring** to grant persistent access to the current site and start Chrome alarms. Each tick captures the **currently active tab in the last focused browser window**, so changing tabs changes the evaluated page. Visiting another site requires granting access there too; otherwise capture fails visibly. **Stop monitoring** removes the alarm. Settings and monitoring state persist; browser startup recreates the alarm. The popup may be closed while monitoring runs.

`intervalSeconds` accepts integers from 30 to 86400. Chrome alarms are approximate and may be delayed by sleep or browser suspension; they do not run while Chrome is closed. Saving settings restarts the interval. An in-flight request may finish after Stop; subsequent ticks are disabled. Requests never overlap within one service worker.

## Data and credentials

The extension captures at most 16,000 characters of page text, 80 visible interactive element descriptions, the title, and the URL without query or fragment. It excludes scripts and form control values. It does not capture cross-origin frames or shadow roots. Page text can still contain sensitive information; this is a bounded summary, not a complete DOM or a privacy sanitizer.

Evaluation sends that summary and your rules to `127.0.0.1:8787`, which calls TypeSafe with `@typesafe-ai/sdk`. The API key stays in the Node process, outside the extension and browser storage. The bridge binds to loopback and rejects ordinary website origins and unexpected Host headers. It accepts extension origins and local non-browser clients; it is intended for local personal development. Do not expose it as a public service.

The initial extension host permission is loopback for its bridge. Other sites are requested individually when monitoring starts. One-shot evaluation uses `activeTab`. Restricted pages such as `chrome://` cannot be evaluated. Only the latest result is saved locally. Decisions are displayed; there is no browser action execution, approval enforcement, or automatic clicking.

## Integration tests

```sh
npx playwright install chromium
npm run check
# Optional visible browser:
npm run test:headed
```

The tests load the **production-built extension** into an isolated Chromium profile. They run the real local bridge and official SDK against a deterministic fake TypeSafe endpoint. No real API key or paid API call is required.

Coverage includes all four choices, the outgoing Choice schema and DOM summary, omission of form values and URL parameters, persisted settings, rule disabling, invalid settings, upstream errors, the actual 30-second alarm after closing the popup and changing the DOM, stopping the alarm, and bridge validation/origin rejection. These verify wiring, not Jev's decision quality. Live model evaluations can be added separately.

GitHub Actions runs lint, type checking, the production build, and the browser suite on pushes and pull requests, uploading traces and reports on failure. Add new scenarios in `tests/extension.spec.ts`; the fake upstream is `tests/mock-api.ts`.

## Structure

- `src/shared.ts`: validated rules, defaults, and typed request/results.
- `src/snapshot.ts`: bounded page extraction.
- `src/background.ts`: captures, API calls, and periodic Chrome alarms.
- `src/App.tsx`: popup and monitoring controls.
- `src/options.tsx`: persisted JSON configuration.
- `server/index.ts`: local credential-owning bridge and Jev Choice request.

No Rust dependencies are used. If Rust is added, use Nix for dependency management and cargo commands, per `AGENTS.md`.
