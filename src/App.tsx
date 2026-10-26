import { useEffect, useState } from 'react';
import type { Latest } from './shared';
import { loadConfig } from './shared';
import ModelSetup from './ModelSetup';

export default function App() {
  const [latest, setLatest] = useState<Latest>();
  const [monitoring, setMonitoring] = useState(false);
  const [error, setError] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [ruleCount, setRuleCount] = useState(0);
  const [debugPaused, setDebugPaused] = useState(false);
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [nextAt, setNextAt] = useState<number>();
  const [now, setNow] = useState(Date.now());
  const [modelReady, setModelReady] = useState(false);
  const [busy, setBusy] = useState(false);
  async function refreshAccess() {
    const access = await chrome.runtime.sendMessage({ type: 'GET_TAB_ACCESS' });
    setAllowed(!!access?.value?.allowed);
  }
  useEffect(() => {
    const refresh = () => chrome.storage.local.get(['latest', 'monitoring', 'highlightEnabled']).then(s => { setLatest(s.latest); setMonitoring(!!s.monitoring); setHighlightEnabled(s.highlightEnabled ?? true);
      void loadConfig().then(config => setRuleCount(config.rules.filter(r => r.enabled && r.canApprove).length));
      void chrome.storage.session.get('debugRun').then(({ debugRun }) => setDebugPaused(!!debugRun && !debugRun.finished)); });
    void refresh(); void refreshAccess();
    const listener = () => { void refresh(); void refreshAccess(); };
    const activated = () => { void refreshAccess(); };
    chrome.tabs.onActivated.addListener(activated);
    chrome.storage.onChanged.addListener(listener);
    const timer = setInterval(() => { setNow(Date.now()); void chrome.alarms.get('jda-evaluate').then(alarm => setNextAt(alarm?.scheduledTime)); }, 1000);
    void chrome.alarms.get('jda-evaluate').then(alarm => setNextAt(alarm?.scheduledTime));
    return () => { clearInterval(timer); chrome.storage.onChanged.removeListener(listener); chrome.tabs.onActivated.removeListener(activated); };
  }, []);
  async function run(type: 'EVALUATE' | 'START' | 'STOP' | 'MARK_ALL_READ' | 'ALLOW_TAB' | 'REVOKE_TAB' | 'POP_SEEN' | 'OPEN_DEBUG' | 'DRY_RUN') {
    setBusy(true); setError('');
    try {
      let requestedTabId: number | undefined;
      if (type === 'ALLOW_TAB') {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab.url || !/^https?:/.test(tab.url)) throw new Error('Open a web page before allowing this tab.');
        requestedTabId = tab.id;
        const site = new URL(tab.url);
        const origins = [`${site.protocol}//${site.hostname}/*`];
        if (!(await chrome.permissions.contains({ origins })) && !(await chrome.permissions.request({ origins }))) throw new Error('Site access is required to allow this tab.');
      }
      const reply = await chrome.runtime.sendMessage({ type, tabId: requestedTabId });
      if (reply.error) throw new Error(reply.error);
      await refreshAccess();
    } catch (e) { setError(e instanceof Error ? e.message : 'Evaluation failed.'); }
    finally { setBusy(false); }
  }
  const remainingSeconds = Math.max(0, Math.ceil(((nextAt ?? now) - now) / 1000));
  return <main className="popup">
    <header><span className="eyebrow">LOCAL AI · DOM · DECISION</span><button className="secondary" onClick={() => chrome.runtime.openOptionsPage()}>Settings</button></header>
    <h1>Hello world, jda.</h1>
    <p>Categorize messages and reply when your rules permit approval.</p>
    <p className="muted">Messages are processed on this device by Chrome’s built-in model. No API key or server is used.</p>
    <ModelSetup onAvailability={setModelReady} />
    <p data-testid="rule-count">Approval rules enabled: {ruleCount}{!ruleCount ? ' · Add canApprove rules in Settings to enable replies.' : ''}</p>
    <p data-testid="tab-access">{allowed ? 'Allowed on this tab' : 'Inactive on this tab'}</p>
    <p data-testid="countdown">{monitoring && nextAt ? `Next evaluation in ${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}` : debugPaused ? 'Timer paused for debugging' : monitoring ? 'Scheduling next evaluation…' : 'Timer stopped'}</p>
    <p data-testid="monitoring">Monitoring {monitoring ? 'on' : 'off'} · interval in Settings</p>
    <div className="controls"><button disabled={busy && !allowed} className="secondary" onClick={() => run(allowed ? 'REVOKE_TAB' : 'ALLOW_TAB')}>{allowed ? 'Disallow this tab' : 'Allow this tab'}</button>
    <button disabled={busy || !allowed || !modelReady} onClick={() => run('EVALUATE')}>{busy ? 'Working…' : monitoring ? 'Eval now' : 'Evaluate current page'}</button>
    <button disabled={busy || ((!allowed || !modelReady) && !monitoring)} className="secondary" onClick={() => run(monitoring ? 'STOP' : 'START')}>{monitoring ? 'Stop monitoring' : 'Start monitoring'}</button>
    <button disabled={busy || !allowed} className="secondary" onClick={() => run('MARK_ALL_READ')}>Mark all as read</button>
    <button disabled={busy || !allowed} className="secondary" onClick={() => run('POP_SEEN')}>Pop seen</button>
    <button disabled={busy || !allowed || !modelReady} className="secondary" onClick={() => run('DRY_RUN')}>Dry run</button>
    <button disabled={busy || !allowed} className="secondary" onClick={() => run('OPEN_DEBUG')}>Open debugger</button></div>
    <label className="toggle"><input type="checkbox" checked={highlightEnabled} onChange={e => { const enabled = e.target.checked; setHighlightEnabled(enabled); void chrome.runtime.sendMessage({ type: 'SET_HIGHLIGHTS', enabled }).then(reply => { if (reply.error) setError(reply.error); }).catch(() => setError('Could not update highlights.')); }} /> Highlight read / unread messages</label>
    <p className="muted">Unread: blue solid · Evaluating: amber double · Read: gray dashed</p>

    {latest?.notice && <p role="status">{latest.notice}</p>}
    {(error || latest?.error) && <p role="alert">{error || latest?.error}</p>}
    {allowed && latest?.result && <section aria-label="Decision result"><h2>{latest.result.decision}</h2>
      <p>Calibrated confidence: {latest.result.confidence === null ? 'unavailable' : `${Math.round(latest.result.confidence * 100)}%`}</p>
      <ul>{Object.entries(latest.result.probabilities ?? {}).map(([label, p]) => <li key={label}>{label}: {Math.round(p * 100)}%</li>)}</ul>
      {latest.result.queryResults?.map(item => <article className="message-result" key={item.index}>
        <strong>Message {item.index + 1}</strong><p className="muted" title={item.id ?? ''}>{item.id && item.id.length > 32 ? `${item.id.slice(0, 12)}…${item.id.slice(-12)}` : item.id ?? 'No stable ID'}</p>
        <p>{item.text.slice(0, 180)}{item.text.length > 180 ? '…' : ''}</p>
        <p>{item.result.decision} · {item.replyStatus ?? item.action}</p>
        <p data-testid="message-reason">{item.reason ?? 'Older result: rerun to see rule diagnostics.'}</p>
        {item.replyError && <p role="alert">{item.replyError}</p>}
        {!!item.ruleChecks?.length && <details><summary>Rule checks ({item.ruleChecks.length})</summary><ul>{item.ruleChecks.map(rule => <li key={rule.ruleId}>{rule.ruleId}: {rule.matched ? 'matched' : 'no match'}</li>)}</ul></details>}
      </article>)}
      <p className="muted">{latest.url}<br />{new Date(latest.evaluatedAt).toLocaleTimeString()}</p></section>}
    <p className="muted">The loop evaluates only an explicitly allowed active tab. Tab allowances end when Chrome closes or the tab changes sites. Matching approval rules automatically reply “approve”.</p>
  </main>;
}
