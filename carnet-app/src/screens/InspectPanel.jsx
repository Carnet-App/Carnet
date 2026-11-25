import { useState } from 'react';
import { inspecting } from '../lib/inspect';

// Shows what the reader saw and decided for this import. Only visible with ?inspect.
export default function InspectPanel({ data }) {
  const [copied, setCopied] = useState(false);
  if (!data || !inspecting()) return null;
  const json = JSON.stringify(data, null, 1);
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `carnet-inspect-${Date.now()}.json`;
    a.click();
  };
  return (
    <details className="card" style={{ padding: 12, font: '12px/1.4 ui-monospace, Menlo, monospace' }}>
      <summary style={{ cursor: 'pointer', font: '600 13px var(--sans)' }}>Inspector · {data.kind} · {Math.round(data.totalMs || 0)} ms</summary>
      <div className="row" style={{ gap: 8, margin: '8px 0' }}>
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(json).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy JSON'}</button>
        <button className="btn sm ghost" onClick={download}>Download</button>
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflow: 'auto', margin: 0 }}>{json}</pre>
    </details>
  );
}
