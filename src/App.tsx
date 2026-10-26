import { useEffect, useState } from 'react';
import type { Latest } from './shared';

export default function App() {
  const [latest, setLatest] = useState<Latest>();
  const [monitoring, setMonitoring] = useState(false);
  const [error, setError] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  async function refreshAccess() {
    const access = await chrome.runtime.sendMessage({ type: 'GET_TAB_ACCESS' });
    setAllowed(!!access?.value?.allowed);
  }
  useEffect(() => {
    const refresh = () => chrome.storage.local.get(['latest', 'monitoring']).then(s => { setLatest(s.latest); setMonitoring(!!s.monitoring); });
    void refresh(); void refreshAccess();
    const listener = () => { void refresh(); void refreshAccess(); };
    const activated = () => { void refreshAccess(); };
    chrome.tabs.onActivated.addListener(activated);
    chrome.storage.onChanged.addListener(listener);
    return () => { chrome.storage.onChanged.removeListener(listener); chrome.tabs.onActivated.removeListener(activated); };
  }, []);
  async function run(type: 'EVALUATE' | 'START' | 'STOP' | 'MARK_ALL_READ' | 'ALLOW_TAB' | 'REVOKE_TAB') {
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
  return <main className="popup">
    <header><span className="eyebrow">JEV · DOM · DECISION</span><button className="secondary" onClick={() => chrome.runtime.openOptionsPage()}>Settings</button></header>
    <h1>Hello world, jda.</h1>
    <p>Categorize messages and reply when your rules permit approval.</p>
    <p className="muted">Evaluation sends captured message text through your local service to TypeSafe. Form values are excluded; page text may contain personal information.</p>
    <p data-testid="tab-access">{allowed ? 'Allowed on this tab' : 'Inactive on this tab'}</p>
    <div className="controls"><button disabled={busy && !allowed} className="secondary" onClick={() => run(allowed ? 'REVOKE_TAB' : 'ALLOW_TAB')}>{allowed ? 'Disallow this tab' : 'Allow this tab'}</button>
    <button disabled={busy || !allowed} onClick={() => run('EVALUATE')}>{busy ? 'Working…' : 'Evaluate current page'}</button>
    <button disabled={busy || (!allowed && !monitoring)} className="secondary" onClick={() => run(monitoring ? 'STOP' : 'START')}>{monitoring ? 'Stop monitoring' : 'Start monitoring'}</button>
    <button disabled={busy || !allowed} className="secondary" onClick={() => run('MARK_ALL_READ')}>Mark all as read</button></div>
    <p data-testid="monitoring">Monitoring {monitoring ? 'on' : 'off'} · interval in Settings</p>
    {latest?.notice && <p role="status">{latest.notice}</p>}
    {(error || latest?.error) && <p role="alert">{error || latest?.error}</p>}
    {allowed && latest?.result && <section aria-label="Decision result"><h2>{latest.result.decision}</h2>
      <p>Confidence: {latest.result.confidence === null ? 'unavailable' : `${Math.round(latest.result.confidence * 100)}%`}</p>
      <ul>{Object.entries(latest.result.probabilities ?? {}).map(([label, p]) => <li key={label}>{label}: {Math.round(p * 100)}%</li>)}</ul>
      {latest.result.queryResults?.map(item => <p key={item.index}>Message {item.id ?? item.index}: {item.result.decision} · {item.replyStatus ?? item.action}{item.replyError ? `: ${item.replyError}` : ''}</p>)}
      <p className="muted">{latest.url}<br />{new Date(latest.evaluatedAt).toLocaleTimeString()}</p></section>}
    <p className="muted">The loop evaluates only an explicitly allowed active tab. Tab allowances end when Chrome closes or the tab changes sites. Matching approval rules automatically reply “approve”.</p>
  </main>;
}
