import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { useAppStore } from '../state/AppStore';
import { hostedRuntime, cloudTranscription } from '../services/runtime';
import { Button, Card, EmptyState } from '../components/ui';
import { ChatGptModal } from '../components/ChatGptModal';

export function SalesPage() {
  const store = useAppStore();
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chat, setChat] = useState(false);
  const transcription = store.transcriptions.find((value) => value.id === id);
  const insights = store.tItems(id).filter((item) => item.tags.includes('sales-intelligence'));
  return <div className="page"><header className="page-header"><div><span className="eyebrow"><TrendingUp size={16} />Workspace</span><h1>{store.settings.locale === 'he' ? 'תובנות מכירה' : 'Sales intelligence'}</h1><p>Keep evidence, interpretation and suggested next steps separate.</p></div></header>
    <Card><label>Source transcription<select value={id} onChange={(event) => setId(event.target.value)}><option value="">Choose a transcript…</option>{store.transcriptions.filter((value) => value.status === 'ready').map((value) => <option key={value.id} value={value.id}>{value.title}</option>)}</select></label>
      <div className="workspace-actions">{!hostedRuntime && !cloudTranscription && <Button busy={busy} disabled={!id} onClick={() => { setBusy(true); setError(''); void store.runSalesAnalysis(id).catch((reason) => setError(String(reason))).finally(() => setBusy(false)); }}>Analyze sales with Ollama</Button>}<Button variant="secondary" disabled={!id} onClick={() => setChat(true)}>ChatGPT review / import</Button>{id && <Link to={`/transcriptions/${id}`}>Open transcript and follow-ups →</Link>}</div>
      {(hostedRuntime || cloudTranscription) && <p className="muted">Use ChatGPT review and import for sales-specific insights. Gemini meeting analysis is available on the transcript.</p>}{error && <p role="alert">{error}</p>}
    </Card>
    <div className="sales-grid">{insights.map((item) => <Card key={item.id} className="sales-insight"><h2 dir="auto">{item.title}</h2><p dir="auto">{item.body}</p><span>{Math.round(item.confidence * 100)}% confidence · AI interpretation</span>{item.uncertaintyReason && <p className="uncertainty">{item.uncertaintyReason}</p>}{store.tSegments(id).filter((value) => item.sourceSegmentIds.includes(value.id)).map((value) => <blockquote key={value.id} dir="auto">{value.text}</blockquote>)}</Card>)}</div>
    {!insights.length && <EmptyState title="No sales insights yet" body="Choose a transcript and request an evidence-based review. Your transcript and task history remain in their own workspace." />}
    {transcription && <ChatGptModal open={chat} onClose={() => setChat(false)} transcription={transcription} segments={store.tSegments(id)} items={insights} onImport={(items) => store.importItems(id, items.map((item) => ({ ...item, kind: 'note', tags: [...item.tags, 'sales-intelligence'] })))} />}
  </div>;
}
