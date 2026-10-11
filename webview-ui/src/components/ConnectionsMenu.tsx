import { useState } from 'react';

import type {
  AddConnection,
  Connection,
  ConnectionKind,
  ConnectionState,
} from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Clipboard } from './ui/Clipboard.js';

const STATE_LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  error: 'Error',
  disabled: 'Disabled',
};

const STATE_COLOR_CLASS: Record<ConnectionState, string> = {
  connecting: 'text-status-permission border-status-permission',
  connected: 'text-status-success border-status-success',
  reconnecting: 'text-status-waiting border-status-waiting',
  error: 'text-status-error border-status-error',
  disabled: 'text-status-idle border-status-idle',
};

function connectionDetail(connection: Connection): string {
  if (connection.kind === 'local') {
    return connection.session ? `session ${connection.session}` : 'This machine';
  }
  return connection.session
    ? `${connection.target} · session ${connection.session}`
    : (connection.target ?? '');
}

function ConnectionRow({ connection }: { connection: Connection }) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState(connection.label);

  return (
    <div
      data-testid="connection-row"
      data-connection-id={connection.id}
      data-state={connection.state}
      className="flex flex-col gap-4 py-6 px-10 border-b-2 border-border"
    >
      <div className="flex items-center justify-between gap-8">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <input
              type="text"
              aria-label="Connection label"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              className="w-full text-sm py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
            />
          ) : (
            <span className="text-sm block overflow-hidden text-ellipsis whitespace-nowrap">
              {connection.label}
            </span>
          )}
          <span className="text-2xs text-text-muted block overflow-hidden text-ellipsis whitespace-nowrap">
            {connectionDetail(connection)}
          </span>
        </div>
        <span
          data-testid="connection-state"
          className={`shrink-0 text-2xs py-1 px-6 border-2 rounded-none ${STATE_COLOR_CLASS[connection.state]}`}
        >
          {STATE_LABELS[connection.state]}
        </span>
      </div>
      {connection.message && (
        <p data-testid="connection-message" className="text-2xs text-text-muted break-words">
          {connection.message}
        </p>
      )}
      <div className="flex items-center gap-4">
        {isRenaming ? (
          <>
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                const label = labelDraft.trim();
                if (label) {
                  transport.send({ type: 'updateConnection', id: connection.id, label });
                }
                setIsRenaming(false);
              }}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLabelDraft(connection.label);
                setIsRenaming(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLabelDraft(connection.label);
              setIsRenaming(true);
            }}
          >
            Rename
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            transport.send({
              type: 'updateConnection',
              id: connection.id,
              enabled: !connection.enabled,
            })
          }
        >
          {connection.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => transport.send({ type: 'removeConnection', id: connection.id })}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

const DEFAULT_KIND: ConnectionKind = 'ssh';

export type AddConnectionInput = Omit<AddConnection, 'type' | 'requestId'>;

interface ConnectionsMenuProps {
  isOpen: boolean;
  onClose: () => void;
  connections: Connection[];
  addConnection: (input: AddConnectionInput) => Promise<string | undefined>;
}

export function ConnectionsMenu({
  isOpen,
  onClose,
  connections,
  addConnection,
}: ConnectionsMenuProps) {
  const [kind, setKind] = useState<ConnectionKind>(DEFAULT_KIND);
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [session, setSession] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    setError(null);
    const trimmedLabel = label.trim();
    const trimmedTarget = target.trim();
    const trimmedSession = session.trim();
    if (!trimmedLabel) {
      setError('Label is required.');
      return;
    }
    if (kind === 'ssh' && !trimmedTarget) {
      setError('SSH target is required.');
      return;
    }
    if (kind === 'local' && !trimmedSession) {
      setError('herdr session is required for a local connection.');
      return;
    }
    setIsPending(true);
    const addError = await addConnection({
      label: trimmedLabel,
      kind,
      target: kind === 'ssh' ? trimmedTarget : undefined,
      session: trimmedSession || undefined,
    });
    setIsPending(false);
    if (addError) {
      setError(addError);
      return;
    }
    setLabel('');
    setTarget('');
    setSession('');
  };

  return (
    <Clipboard isOpen={isOpen} onClose={onClose} title="Connections">
      {connections.map((connection) => (
        <ConnectionRow key={connection.id} connection={connection} />
      ))}
      <div className="flex flex-col gap-6 py-6 px-10 border-t-2 border-border">
        <select
          aria-label="Connection kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as ConnectionKind)}
          disabled={isPending}
          className="text-xs py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
        >
          <option value="ssh">SSH</option>
          <option value="local">Local session</option>
        </select>
        <input
          type="text"
          aria-label="New connection label"
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={isPending}
          className="text-xs py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
        />
        {kind === 'ssh' && (
          <input
            type="text"
            aria-label="SSH target"
            placeholder="user@host or ssh alias"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={isPending}
            className="text-xs py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
          />
        )}
        <input
          type="text"
          aria-label="herdr session"
          placeholder={kind === 'local' ? 'herdr session (required)' : 'herdr session (optional)'}
          value={session}
          onChange={(e) => setSession(e.target.value)}
          disabled={isPending}
          className="text-xs py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
        />
        {error && (
          <p data-testid="connection-add-error" className="text-2xs text-status-error">
            {error}
          </p>
        )}
        <Button variant="default" size="sm" onClick={handleAdd} disabled={isPending}>
          {isPending ? 'Checking…' : 'Add'}
        </Button>
      </div>
      <p className="text-2xs text-text-muted px-10 py-6">
        SSH uses your OpenSSH config and agent. No passwords or keys are stored.
      </p>
    </Clipboard>
  );
}
