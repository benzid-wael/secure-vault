import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { dotenvChanges } from '../../utils/dotenv';

const KIND = {
  changed: 'changed',
  removed: 'removed',
  added: 'added',
};

/**
 * Edit an env's own variables as .env text (GUI-ENV-BREAKDOWN Task 21).
 * Saving sends one changeset holding only the keys that changed. A key
 * changed elsewhere meanwhile comes back as a conflict, listed here, with
 * the choice to overwrite; the draft stays until the dialog is closed.
 *
 * `load()` resolves to `{ success, text }`; `save(ops, { force })` to the
 * commit result. `onOpenHistory` is offered when the version cap is hit.
 */
export default function EnvBulkEditDialog({
  env,
  load,
  save,
  onDone,
  onOpenHistory,
  onClose,
}) {
  const [base, setBase] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState(null);
  const [limit, setLimit] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    load().then((result) => {
      if (!active) return;
      if (!result.success) return setError(result.error || 'Could not load');
      setBase(result.text);
      setDraft(result.text);
    });
    return () => {
      active = false;
    };
  }, [load]);

  const { ops, warnings } = useMemo(
    () =>
      base === null ? { ops: [], warnings: [] } : dotenvChanges(base, draft),
    [base, draft]
  );

  const submit = async (force = false) => {
    setBusy(true);
    setError('');
    const result = await save(ops, { force });
    setBusy(false);
    if (result.success) return onDone(result, ops.length);
    if (result.code === 'CONFLICT') return setConflicts(result.conflicts ?? []);
    if (result.code === 'LIMIT') return setLimit(true);
    setError(result.error || 'Something went wrong');
  };

  const envGone = conflicts?.some((c) => c.kind === 'env-gone');
  const counts = {
    set: ops.filter((o) => o.op === 'set').length,
    rm: ops.filter((o) => o.op === 'rm').length,
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Edit {env} as .env</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {limit && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <Button color="inherit" onClick={onOpenHistory}>
                Open history
              </Button>
            }
          >
            {env} has reached its version limit. Squash its history, then save
            again; your draft is kept until you close this dialog.
          </Alert>
        )}
        {conflicts && envGone && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {env} was deleted elsewhere. Copy your draft before closing.
          </Alert>
        )}
        {conflicts && !envGone && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <Button
                color="inherit"
                disabled={busy}
                onClick={() => submit(true)}
              >
                Overwrite
              </Button>
            }
          >
            Changed elsewhere since you opened it:
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {conflicts.map((c) => (
                <li key={c.key} data-testid={`conflict-${c.key}`}>
                  <code>{c.key}</code> ({KIND[c.kind] ?? c.kind})
                </li>
              ))}
            </Box>
            Overwrite keeps your version of these keys.
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Fix these lines before saving:
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {warnings.map((w) => (
                <li key={`${w.line}:${w.message}`}>
                  Line {w.line}: {w.message}
                </li>
              ))}
            </Box>
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          One <code>KEY=value</code> per line. <code>#</code> lines right above
          a key are its comment. Quote values with spaces at the ends or line
          breaks. New keys are secret. Inherited keys aren&apos;t listed.
        </Typography>
        <TextField
          id="env-bulk-text"
          label=".env"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setConflicts(null);
          }}
          fullWidth
          multiline
          minRows={10}
          maxRows={24}
          disabled={base === null}
          inputProps={{
            spellCheck: false,
            style: { fontFamily: 'monospace', fontSize: 13 },
          }}
        />
      </DialogContent>
      <DialogActions>
        <Typography variant="body2" sx={{ mr: 'auto', ml: 2 }}>
          {ops.length === 0
            ? 'No changes'
            : `${counts.set} to set, ${counts.rm} to remove`}
        </Typography>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={busy || ops.length === 0 || warnings.length > 0 || envGone}
          onClick={() => submit(false)}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
