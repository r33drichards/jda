# jda

A Chrome extension that runs **Gemini Nano on-device** to categorize messages and reply **approve** when an approval request matches one of your permission rules. No API key, local service, or hosted AI endpoint is required.

Built with React, TypeScript, Vite/CRXJS, and Chrome's [Prompt API](https://developer.chrome.com/docs/ai/prompt-api). Originally based on [yosevu/react-chrome-extension-template](https://github.com/yosevu/react-chrome-extension-template).

## Install and prepare the model

Requires desktop Google Chrome 138+ with a supported device. Plain Chromium may load the extension but generally lacks the Google-only components needed for Gemini Nano ([CEF status](https://github.com/chromiumembedded/cef/issues/3982)); unavailable builds perform no inference or approval. Chrome controls hardware eligibility, model availability, and the initial model download. An up-to-date browser alone does not guarantee the model is available.

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `dist`. If jda is already loaded, reload it after building.

Open jda's popup or Settings. If the model is **downloadable** or **downloading**, click **Prepare model** and keep the page open until it says **available**. Chrome may download the model the first time; subsequent message inference runs on-device. **Unavailable** means this browser/device cannot run the API: jda will not process messages or approve anything, and there is no cloud fallback. Model preparation starts only from your button click, never from a timer.

The background worker feature-detects `LanguageModel` and checks availability before processing. It creates fresh sessions with English text inputs/outputs. No experimental flags or origin-trial permissions are configured.

## Allowed tabs

Every tab starts inactive. Open the target page, click jda, and choose **Allow this tab**. **Disallow this tab** remains available during inference and revokes pending reply permission. Other tabs on the same site require their own allowance.

Allowances live in trusted extension `chrome.storage.session`, scoped to the tab ID, exact origin, and a fresh token. They survive worker suspension and same-site reloads, but end when the tab closes, changes sites, is replaced, or the browser/extension restarts. Permission is checked before capturing the DOM, before each inference batch, before opening Reply, and immediately before Send. An in-progress model computation may finish after revocation; it cannot subsequently send a reply.

Chrome grants host access per site, but jda enforces its own additional per-tab gate. The production manifest has **no default host permissions**. Site permission is requested when you explicitly allow a tab.

## Query and two-stage decisions

`src/snapshot.ts` enumerates `.message-text` elements and captures:

```ts
{ index, id: element.closest('.message-body')?.dataset.messageId ?? null, text: element.innerText.trim() }
```

At most 4,000 characters are captured per message. The seen filter forwards at most 30 unread messages and 16,000 message characters per evaluation. `src/query.ts` validates this list.

1. **Categorization:** local model batches classify messages as `update`, `asking for approval`, `clarifying question`, or `other`. Permission rules are excluded from this stage.
2. **Rules:** only approval-category messages are checked against enabled rules with `canApprove: true`. Each rule returns a boolean permission decision. If any rule explicitly permits the entire requested action, jda replies exactly `approve`. Missing/ambiguous evidence should return false. Other categories and unmatched approval requests do nothing.

Local inference uses small batches (four messages or four rules) with JSON Schema response constraints. Runtime validation additionally requires every requested index/key exactly once, with no missing, duplicate, extra, or invalid answers. Any model error, malformed JSON, oversized context, or invalid result aborts the evaluation before any reply. No partial set of approvals is executed. Each prompt uses a fresh session, checks context capacity when supported, has a 60-second cancellation timeout, and destroys the session afterwards.

The model does not return calibrated confidence/probabilities; jda leaves those fields null rather than inventing numbers. Model judgments can be wrong; integration tests verify the wiring and execution gates, not real-model accuracy.

Stage one supplies only message objects to the model. Stage two also includes a bounded page summary: URL without query/fragment, title, up to 4,000 text characters, and 20 interactive-element descriptions. Page scripts, form values, and composer drafts are excluded by the capture logic. Page/message text can still contain personal information, but the extension does not send it to an external AI service. Frames and shadow roots are not queried.

## Rules and reply selectors

Open **Settings** and edit the JSON. For example:

```json
{
  "intervalSeconds": 60,
  "rules": [
    {
      "id": "local-tests",
      "description": "The action only runs local tests without modifying files or external systems.",
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

Default rules are empty, so no automatic reply is permitted until you configure a rule. Rules marked `canApprove: false` do not grant permission and are not veto rules.

For a permitted reply, jda locates `.message-body[data-message-id="…"]`, finds its `button[aria-label="Reply"]`, scrolls/hovers/clicks it, and fills the configured editor. Selectors must each identify exactly one visible element. Inputs, textareas, and contenteditable editors are supported. Existing drafts are never overwritten. jda waits for Send to become enabled, verifies the exact message and `approve` draft again, checks the tab token, and clicks Send. A stable message ID is required; index-only and truncated messages cannot be replied to automatically. DOM actions target the exact document originally captured.

Legacy settings automatically discard the old `model` name while preserving interval, rules, and reply selectors. Old categorization rules without `canApprove` default to false.

## Seen list, read button, and receipts

`chrome.storage.local.seenMessages` stores SHA-256 fingerprints of normalized page URL, message ID (or null), and captured text, plus processing states/timestamps. It survives reloads and browser restarts. Moving an unchanged message does not make it unread; edited content does. Changing rules does not reprocess old messages.

The batch is reserved before inference to prevent repeats after worker interruption, and marked processed only after both stages validate. Explicit model/validation failures release the reservation for a later retry. If the worker is interrupted mid-computation, its reserved batch remains seen. An entirely seen page makes no inference call.

**Mark all as read** marks every currently loaded message on the allowed active tab as seen, including those beyond one processing batch. It requires no model, performs no inference, sends no reply, and does not change the website's own read state. Unloaded messages are unaffected.

`chrome.storage.local.approvalReceipts` separately records reply attempts by normalized page URL and stable message ID, before clicking. Even an edited message cannot receive a second automatic approval for the same ID. Interrupted or failed attempts are not retried automatically. `sent` means the Send button was clicked, not that delivery was independently confirmed. Inspect the page before retrying manually. Clearing extension data resets seen records and receipts.

## Monitoring

**Evaluate current page** runs once, including any permitted replies. **Start monitoring** repeats for the explicitly allowed active tab in the last focused browser window. It does not scan all tabs and works with the popup closed once the model is ready. **Stop monitoring** cancels future ticks; an in-flight inference may finish, and the tab gate still controls replies.

Intervals are 30–86400 seconds. Chrome alarms are approximate, can be delayed by sleep, and do not run with Chrome closed. Settings, seen state, receipts, and the monitoring preference persist, but browser restart requires explicitly allowing tabs again. Overlapping evaluations are prevented within the worker.

## Tests

```sh
npx playwright install chromium
npm run check
```

Tests load the built extension in disposable Chromium profiles and fake the native `LanguageModel` boundary in extension documents and the background worker. They do not download a model, require a key, or call an AI service. A development-only HTTP fixture serves a page with messages, Reply buttons, a ProseMirror-shaped contenteditable editor, and Send. This fixture server is used only by tests; jda has no runtime server.

Coverage includes both decision stages, valid/invalid constrained results, context limits, model availability/download setup, no outbound AI requests, per-tab isolation/revocation, DOM replies, draft preservation, duplicate prevention, persistent seen filtering, Mark all as read, later batches, error retries, and the actual 30-second alarm with the popup closed. Actual Gemini Nano availability, latency, and decision quality must be checked on an eligible Chrome installation. GitHub Actions runs tests on Ubuntu 24.04.

## Code

- `src/snapshot.ts` → `src/query.ts`: capture and validate message objects.
- `src/model.ts`: native model availability, download setup, and constrained sessions.
- `src/decide.ts`: local categorization and permission-rule stages.
- `src/tabs.ts`: trusted per-tab allowances.
- `src/seen.ts`: fingerprints and unread batch selection.
- `src/background.ts`: monitoring, seen state, and reply receipts.
- `src/reply.ts`: exact-message Reply/editor/Send automation.

No Rust dependencies are used. If Rust is added, use Nix for dependency management and cargo commands per `AGENTS.md`.
