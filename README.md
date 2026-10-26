# jda

A Chrome extension that extracts messages, categorizes them with TypeSafe Jev, and replies **approve** when an approval request matches any enabled permission rule.

Based on [yosevu/react-chrome-extension-template](https://github.com/yosevu/react-chrome-extension-template), using React, TypeScript, Vite/CRXJS, the [official Jev SDK](https://github.com/typesafe-ai/typesafe-sdk-js), and Playwright integration tests.

## Run

Requires Node 24+, npm 11+, and Chrome 120+.

```sh
npm ci
cp .env.example .env
# Set TYPESAFE_API_KEY in .env.
npm run server
```

In another terminal run `npm run build`. In `chrome://extensions`, enable Developer mode and **Load unpacked** from `dist`. Open the target page and use jda's toolbar popup. The local server must remain running.

## Two stages

1. **Categorization:** all captured messages are classified in one Jev request as `update`, `asking for approval`, `clarifying question`, or `other`. Rules do not influence categorization.
2. **Permission rules:** only `asking for approval` messages enter a second batched Jev request. Each enabled rule with `canApprove: true` is checked separately for each approval message. If **any** rule returns `can approve`, the extension clicks that message's Reply button, enters exactly `approve`, and clicks Send. No matching rule means no action. Every other category does nothing.

These are model judgments. There is no confidence threshold. `canApprove: false` rules do not grant permission and are not veto rules. Default rules are empty, so no replies are authorized until you configure them.

## DOM query

The browser captures `.message-text` elements using:

```ts
{
  index,
  id: element.closest('.message-body')?.dataset.messageId ?? null,
  text: element.innerText.trim()
}
```

`server/query.ts` returns the captured messages. The query is implemented, replacing the earlier TODO. The browser enumerates current messages locally, capturing at most 4,000 characters per message. After seen filtering, each Jev batch includes at most 30 unread messages and 16,000 message characters. Later ticks can process subsequent unread batches. Stage one sends message objects to Jev. Stage two also supplies bounded page text and interactive element metadata as context for permission rules. Full HTML and form values are excluded. Frames and shadow roots are not queried.

For a permitted reply, the extension locates `.message-body[data-message-id="…"]`, finds `button[aria-label="Reply"]` inside it, scrolls and dispatches mouseover, then clicks Reply. Automatic replies require a stable message ID; index-only messages are classified but never replied to. The exact message text is checked against the captured text before opening Reply and again before Send. Truncated messages cannot pass the full-text check, so they are not automatically approved.

## Settings

Use the popup's **Settings** button to edit JSON:

```json
{
  "model": "jev-latest",
  "intervalSeconds": 60,
  "rules": [
    {
      "id": "local-tests",
      "description": "The requested action only runs local tests and does not modify files or external systems.",
      "canApprove": true,
      "enabled": true
    }
  ],
  "reply": {
    "editorSelector": "div.ProseMirror[contenteditable=\"true\"][aria-label=\"Message\"]",
    "sendSelector": "button[aria-label=\"Send\"]"
  }
}
```

Both default selectors come from the supplied page HTML: the ProseMirror editor labeled Message and the button labeled Send. Change them in Settings if your page uses a different composer. Each selector must resolve to one visible element after Reply opens. Existing drafts are never overwritten, and disabled Send buttons are not clicked. Missing or ambiguous selectors produce a per-message error without sending.

Existing settings from the earlier categorization-rule format are accepted, but old rules default to `canApprove: false`; explicitly configure permission rules to authorize replies.

## Seen messages and Mark all as read

The popup's **Mark all as read** button marks every currently loaded `.message-text` item on the active page as seen, including items beyond the first processing batch. It makes no Jev call, clicks no Reply/Send button, and does not change the website's own read status. Messages not loaded in the DOM are unaffected.

`chrome.storage.local.seenMessages` stores SHA-256 fingerprints of the normalized page URL, message ID (or null), and captured text, plus timestamps and processing states. Moving messages does not change their identity. An edit is new data and is eligible for classification again. Existing approval receipts still prevent a second automatic reply to the same message ID. Fingerprints persist through reloads, monitoring restarts, and browser restarts. Changing rules does not make old messages unread.

Unchanged seen messages are excluded before calling the local service/Jev. An entirely seen page produces a “No unread messages to process” status and makes no request. The batch is reserved persistently before Jev and marked processed once categorization/rule checks succeed, even when no rule matches or a later reply fails. API or result-validation failures release the reservation so the next evaluation may retry. If the worker is interrupted mid-request, the reserved batch remains seen rather than risking repeated processing. Clearing extension data resets the seen list.

## Periodic monitoring and duplicates

**Evaluate current page** runs the full pipeline once, including authorized replies. **Start monitoring** grants access to the current site and repeats the pipeline for the currently active tab in the last focused browser window. New sites need their own access grant. Settings and monitoring persist. The loop works with the popup closed. **Stop monitoring** cancels subsequent ticks; an in-flight evaluation may finish.

The interval accepts 30–86400 seconds. Chrome alarms are approximate and may be delayed by sleep or browser suspension. They do not run with Chrome closed. Saving settings reschedules the interval. Requests do not overlap within a service worker.

Before attempting a reply, the extension stores a receipt keyed by page URL (without query/fragment) and message ID. Subsequent evaluations will not automatically retry that message, including after worker restart or an uncertain send failure. `sent` means the Send button was clicked; it does not independently confirm delivery. Inspect the page before manually retrying failed/uncertain attempts. Receipts are stored in `chrome.storage.local.approvalReceipts` and survive browser restarts; reinstalling or clearing extension data resets them.

## Credentials and permissions

The API key stays in the local Node service. The extension sends messages to `127.0.0.1:8787`, which calls TypeSafe. Message text may contain personal information. The service binds to loopback, rejects ordinary website origins and unexpected Host headers, and is intended for local personal use. Other local clients and extensions may access it. Do not expose it as a public endpoint.

One-shot evaluation uses `activeTab`; monitoring requests persistent site access. Chrome-internal pages are unsupported. DOM actions are pinned to the exact captured document and message ID so navigation cannot redirect a reply into a different document.

## Tests

```sh
npx playwright install chromium
npm run check
```

Tests load the production-built extension in isolated Chromium profiles, run the real Node bridge and official SDK against a deterministic fake TypeSafe API, and exercise a message/Reply/composer/Send fixture. No paid key is needed. Coverage includes categorization, two-stage routing, multiple permission rules, actual `approve` submission on the fixture, no action for other categories, no matching rules, disabled/non-permitting rules, duplicate suppression, changed messages, missing selectors, settings, upstream failure, an actual 30-second alarm after closing the popup, persisted seen filtering, edited/new messages, Mark all as read beyond one batch, subsequent unread batches, and API-failure retries.

GitHub Actions runs the same checks on Ubuntu 24.04. Tests verify wiring and DOM actions, not live Jev accuracy or your site's actual editor integration. Use `npm run test:headed` for a visible browser.

## Code

- `src/snapshot.ts`: message and page capture.
- `server/query.ts`: message query contract.
- `server/decide.ts`: categorization and permission-rule batches.
- `src/background.ts`: periodic loop, Mark all as read, and persistent reply receipts.
- `src/seen.ts`: persisted message fingerprints and unread batch selection.
- `src/reply.ts`: exact-message Reply/editor/Send adapter.
- `src/shared.ts`: configuration and result validation.

If Rust is added, use Nix to manage dependencies and run cargo, per `AGENTS.md`.
