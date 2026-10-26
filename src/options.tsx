import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { configSchema, loadConfig } from './shared';
import '@lib/styles/globals.css';

export function OptionsApp() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => { loadConfig().then(c => setText(JSON.stringify(c, null, 2))).catch(() => setStatus('Could not load settings.')); }, []);
  async function save() {
    try {
      const config = configSchema.parse(JSON.parse(text));
      await chrome.storage.local.set({ config });
      await chrome.runtime.sendMessage({ type: 'RESCHEDULE' });
      setStatus('Settings saved.');
    } catch (error) { setStatus(`Invalid settings: ${error instanceof Error ? error.message : 'Unknown error'}`); }
  }
  return <main className="settings"><span className="eyebrow">JDA / CONFIGURATION</span><h1>Rules for this browser.</h1>
    <p>Stage one categorizes messages. Stage two evaluates only approval requests against enabled rules with canApprove: true. Any matching rule sends “approve”; other categories do nothing. Configure the reply editor and Send selectors below. Set intervalSeconds to 30–86400 for periodic evaluation.</p>
    <label htmlFor="config">Jev configuration (JSON)</label><textarea id="config" spellCheck={false} value={text} onChange={e => setText(e.target.value)} />
    <button onClick={save}>Save settings</button><p role="status">{status}</p>
    <p className="muted">API credentials belong in the local server’s .env file. Start it with npm run server.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><OptionsApp /></StrictMode>);
