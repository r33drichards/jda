import { useEffect, useState } from 'react';
import { modelAvailability, prepareModel } from './model';
import type { ModelAvailability } from './model';

export default function ModelSetup({ onAvailability }: { onAvailability?: (ready: boolean) => void }) {
  const [availability, setAvailability] = useState<ModelAvailability>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState('');
  useEffect(() => { void modelAvailability().then(status => { setAvailability(status); onAvailability?.(status === 'available'); }).catch(() => { setAvailability('unavailable'); onAvailability?.(false); }); }, [onAvailability]);
  async function prepare() {
    setBusy(true); setError('');
    try { await prepareModel(setProgress); setAvailability('available'); onAvailability?.(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Model preparation failed.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Chrome model setup">
    <p data-testid="model-status">Chrome model: {busy ? `preparing${progress === undefined ? '…' : ` ${progress}%`}` : availability ?? 'checking…'}</p>
    {availability !== 'available' && <button disabled={busy || availability === 'unavailable' || !availability} onClick={prepare}>Prepare model</button>}
    {availability === 'unavailable' && <p>Built-in AI requires a supported desktop Chrome and eligible hardware. Processing is disabled on this device.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
