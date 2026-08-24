import { Building2, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AppSettings } from '../domain/types';
import { fetchCrmDirectory, type CrmDestination, type CrmDirectory } from '../services/crmTransfer';
import { Button, Field, Modal } from './ui';

export function CrmDestinationModal({
  open,
  onClose,
  settings,
  busy,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  busy: boolean;
  onSubmit: (destination: CrmDestination) => Promise<void>;
}) {
  const [directory, setDirectory] = useState<CrmDirectory>({ clients: [], projects: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [newName, setNewName] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const loadDirectory = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchCrmDirectory(settings);
      setDirectory(result);
      setClientId((current) => current && result.clients.some((client) => client.id === current) ? current : (result.clients[0]?.id || ''));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load clients from the CRM.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setProjectId('');
    void loadDirectory();
  // settings are intentionally read when the picker opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedClient = directory.clients.find((client) => client.id === clientId);
  const projects = useMemo(
    () => directory.projects.filter((project) => clientId && project.clientIds.includes(clientId)),
    [clientId, directory.projects],
  );

  useEffect(() => {
    if (projectId && !projects.some((project) => project.id === projectId)) setProjectId('');
  }, [projectId, projects]);

  const submit = async () => {
    setError('');
    try {
      if (mode === 'existing') {
        if (!clientId) return setError('Choose a client before syncing.');
        await onSubmit({ contactId: clientId, projectId: projectId || undefined });
        return;
      }
      if (!newName.trim()) return setError('Enter the new client name.');
      await onSubmit({
        newContact: {
          name: newName.trim(),
          company: newCompany.trim() || undefined,
          email: newEmail.trim() || undefined,
          phone: newPhone.trim() || undefined,
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'CRM sync failed.');
    }
  };

  return <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="Send transcription to CRM" wide>
    <div className="chatgpt-flow">
      <div className="privacy-card"><Building2 /><div><strong>Choose where this transcription belongs</strong><p>The summary, timeline, notes and takeaways will be added to the client card. Tasks will be linked to the same client and, when selected, the project.</p></div></div>

      <div className="segmented-control">
        <button className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>Existing client</button>
        <button className={mode === 'new' ? 'active' : ''} onClick={() => { setMode('new'); setProjectId(''); }}><Plus size={15} />New client</button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {mode === 'existing' ? <>
        <Field label="Client" hint={loading ? 'Loading clients from CodeCrafterCRM…' : `${directory.clients.length} clients available`}>
          <select value={clientId} disabled={loading || busy} onChange={(event) => { setClientId(event.target.value); setProjectId(''); }}>
            {!directory.clients.length && <option value="">No clients loaded</option>}
            {directory.clients.map((client) => <option value={client.id} key={client.id}>{client.name}{client.company && client.company !== client.name ? ` · ${client.company}` : ''}</option>)}
          </select>
        </Field>
        {selectedClient && <div className="muted">{[selectedClient.email, selectedClient.phone].filter(Boolean).join(' · ') || 'No email or phone saved'}</div>}
        <Field label="Project" hint="Optional. Leave this empty to attach the transcription to the client only.">
          <select value={projectId} disabled={!clientId || loading || busy} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">No project / client only</option>
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select>
        </Field>
        {clientId && !loading && projects.length === 0 && <p className="muted">This client has no linked projects in the CRM. The call can still be synced directly to the client card.</p>}
      </> : <>
        <div className="item-edit-grid">
          <Field label="Client name"><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Required" autoFocus /></Field>
          <Field label="Company"><input value={newCompany} onChange={(event) => setNewCompany(event.target.value)} placeholder="Optional" /></Field>
          <Field label="Email"><input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="Optional" /></Field>
          <Field label="Phone"><input value={newPhone} onChange={(event) => setNewPhone(event.target.value)} placeholder="Optional" /></Field>
        </div>
        <p className="muted">The client will be created in CodeCrafterCRM and this transcription will immediately become part of that client card.</p>
      </>}

      <div className="form-actions">
        <Button variant="secondary" disabled={loading || busy} onClick={() => void loadDirectory()}><RefreshCw size={16} />Refresh CRM</Button>
        <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button busy={busy} disabled={loading || (mode === 'existing' ? !clientId : !newName.trim())} onClick={() => void submit()}>{mode === 'new' ? 'Create client & sync' : 'Sync to selected client'}</Button>
      </div>
    </div>
  </Modal>;
}
