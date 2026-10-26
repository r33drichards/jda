import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DebugRun } from './debug-types';
import ModelSetup from './ModelSetup';
import '@lib/styles/globals.css';

export function Debugger() {
  const [run, setRun] = useState<DebugRun>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [includeSeen, setIncludeSeen] = useState(false);
  const target = Number(new URLSearchParams(location.search).get('tab'));
  useEffect(() => {
    const refresh = () => chrome.storage.session.get('debugRun').then(s => setRun(s.debugRun));
    void refresh();
    const listener = () => { void refresh(); }; chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  async function command(type: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const reply = await chrome.runtime.sendMessage({ type, tabId: target || run?.tabId, includeSeen });
      if (reply.error) throw new Error(reply.error);
      if (reply.value?.notice) setNotice(reply.value.notice);
    } catch (e) { setError(e instanceof Error ? e.message : 'Debug action failed.'); }
    finally { setBusy(false); }
  }
  function exportTrace() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(run ? { ...run, token: undefined } : run, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `jda-debug-${run?.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="debugger">
    <span className="eyebrow">JDA / STEP THROUGH</span><h1>Inspect every stage.</h1>
    <p>Start pauses monitoring. Step through a captured snapshot without marking messages seen or sending replies. Trace data stays in extension session memory.</p>
    <ModelSetup />
    <label className="toggle"><input type="checkbox" checked={includeSeen} onChange={e => setIncludeSeen(e.target.checked)} /> Include seen messages in this preview</label>
    <div className="debug-toolbar">
      <button disabled={busy || !(target || run?.tabId)} onClick={() => command('DEBUG_START')}>Start new debug run</button>
      <button disabled={busy || !run || run.finished || (!!target && target !== run.tabId)} onClick={() => command('DEBUG_NEXT')}>{run?.steps[run.next]?.status === 'error' ? 'Retry stage' : `Next: ${run?.steps[run.next]?.name ?? 'complete'}`}</button>
      <button className="secondary" disabled={busy || !run || run.finished} onClick={() => command('DEBUG_FINISH')}>Finish preview</button>
      <button className="secondary" disabled={busy || !(target || run?.tabId)} onClick={() => command('POP_SEEN')}>Pop seen</button>
      <button className="secondary" disabled={!run} onClick={exportTrace}>Export trace JSON</button>
      <button className="secondary" disabled={busy || !run} onClick={() => command('DEBUG_CLEAR')}>Clear trace</button>
    </div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {run && <>
      <p data-testid="debug-state">{run.finished ? 'Preview finished · no replies sent' : run.steps.some(step => step.status === 'running') ? 'Evaluating preview · monitoring off' : 'Paused between stages · monitoring off'} · target tab {run.tabId}</p>
      {run.steps.map((step, i) => <section key={step.name} aria-label={step.name} className="debug-stage">
        <h2>{i + 1}. {step.name}</h2><p>{step.status}{step.elapsedMs === undefined ? '' : ` · ${step.elapsedMs} ms`}</p>
        {step.error && <p role="alert">{step.error}</p>}
        {step.input !== undefined && <details><summary>Input</summary><pre>{JSON.stringify(step.input, null, 2)}</pre></details>}
        {step.output !== undefined && <details open><summary>Result</summary><pre>{JSON.stringify(step.output, null, 2)}</pre></details>}
      </section>)}
      <section aria-label="Model traces"><h2>Model requests and responses</h2><p>{run.traceCount} calls · showing latest {run.traces.length}</p>
        {run.traces.map((trace, i) => <details key={i}><summary>Call {run.traceCount - run.traces.length + i + 1} · {trace.elapsedMs} ms · {trace.error ? 'error' : 'returned'}</summary>
          <pre>{JSON.stringify(trace, null, 2)}</pre></details>)}
      </section>
    </>}
    <p className="muted">Pop seen makes the latest read message on the target page unread; approval receipts remain. If the target document or allowance changes, start a new run. Start a new run to inspect it again. For live replies, finish the preview and evaluate from the target tab’s popup.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Debugger /></StrictMode>);
