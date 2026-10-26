import { useEffect, useState } from 'react';
import type { Latest } from './shared';

export default function App() {
  const [latest, setLatest] = useState<Latest>();
  const [monitoring, setMonitoring] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => chrome.storage.local.get(['latest', 'monitoring']).then(s => { setLatest(s.latest); setMonitoring(!!s.monitoring); });
    void refresh();
    const listener = () => { void refresh(); };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  async function run(type: 'EVALUATE' | 'START' | 'STOP' | 'MARK_ALL_READ') {
    setBusy(true); setError('');
    try {
      if (type === 'START') {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab.url || !/^https?:/.test(tab.url)) throw new Error('Open a web page before starting monitoring.');
        const site = new URL(tab.url);
        const origins = [`${site.protocol}//${site.hostname}/*`];
        if (!(await chrome.permissions.contains({ origins })) && !(await chrome.permissions.request({ origins }))) throw new Error('Site access is required for periodic evaluation.');
      }
      const reply = await chrome.runtime.sendMessage({ type });
      if (reply.error) throw new Error(reply.error);
    } catch (e) { setError(e instanceof Error ? e.message : 'Evaluation failed.'); }
    finally { setBusy(false); }
  }
  return <main className="popup">
    <header><span className="eyebrow">JEV · DOM · DECISION</span><button className="secondary" onClick={() => chrome.runtime.openOptionsPage()}>Settings</button></header>
    <h1>Hello world, jda.</h1>
    <p>Categorize messages and reply when your rules permit approval.</p>
    <p className="muted">Evaluation sends captured message text through your local service to TypeSafe. Form values are excluded; page text may contain personal information.</p>
    <div className="controls"><button disabled={busy} onClick={() => run('EVALUATE')}>{busy ? 'Working…' : 'Evaluate current page'}</button>
    <button disabled={busy} className="secondary" onClick={() => run(monitoring ? 'STOP' : 'START')}>{monitoring ? 'Stop monitoring' : 'Start monitoring'}</button>
    <button disabled={busy} className="secondary" onClick={() => run('MARK_ALL_READ')}>Mark all as read</button></div>
    <p data-testid="monitoring">Monitoring {monitoring ? 'on' : 'off'} · interval in Settings</p>
    {latest?.notice && <p role="status">{latest.notice}</p>}
    {(error || latest?.error) && <p role="alert">{error || latest?.error}</p>}
    {latest?.result && <section aria-label="Decision result"><h2>{latest.result.decision}</h2>
      <p>Confidence: {latest.result.confidence === null ? 'unavailable' : `${Math.round(latest.result.confidence * 100)}%`}</p>
      <ul>{Object.entries(latest.result.probabilities ?? {}).map(([label, p]) => <li key={label}>{label}: {Math.round(p * 100)}%</li>)}</ul>
      {latest.result.queryResults?.map(item => <p key={item.index}>Message {item.id ?? item.index}: {item.result.decision} · {item.replyStatus ?? item.action}{item.replyError ? `: ${item.replyError}` : ''}</p>)}
      <p className="muted">{latest.url}<br />{new Date(latest.evaluatedAt).toLocaleTimeString()}</p></section>}
    <p className="muted">The loop evaluates the active tab on sites you grant access to. Matching approval rules automatically reply “approve”.</p>
  </main>;
}
