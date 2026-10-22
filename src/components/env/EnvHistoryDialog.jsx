import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

/**
 * An env's versions, newest first (GUI-ENV-BREAKDOWN Task 25), with
 * rollback and squash behind a plain confirm. Only key names arrive here,
 * never values. `run(action)` performs an IPC call and resolves to its
 * result; on success the dialog closes through `onDone(message)`.
 */
export default function EnvHistoryDialog({ env, load, run, onDone, onClose }) {
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind: 'rollback', n } | { kind: 'squash' }
  const [keep, setKeep] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    load().then((result) => {
      if (!active) return;
      if (result.success) setVersions(result.versions);
      else setError(result.error || 'Could not read the history');
    });
    return () => {
      active = false;
    };
  }, [load]);

  const act = async () => {
    setBusy(true);
    const result = await run(confirm);
    setBusy(false);
    if (!result.success) {
      setError(result.error || 'Something went wrong');
      setConfirm(null);
      return;
    }
    onDone(
      confirm.kind === 'rollback'
        ? `${env} is back to version ${confirm.n}, saved as a new version.`
        : `Squashed ${env}'s history. A copy of the vault was kept (${result.snapshot}).`
    );
  };

  const active = versions?.find((v) => v.isActive);
  const keyDiff = (v) => {
    if (!active || v.isActive) return '';
    const added = v.keys.filter((k) => !active.keys.includes(k)).length;
    const removed = active.keys.filter((k) => !v.keys.includes(k)).length;
    return [added && `+${added}`, removed && `−${removed}`]
      .filter(Boolean)
      .join(' ');
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>History of {env}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {confirm?.kind === 'rollback' && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <>
                <Button color="inherit" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button color="inherit" disabled={busy} onClick={act}>
                  Roll back
                </Button>
              </>
            }
          >
            Make version {confirm.n} current? It is saved as a new version;
            nothing is lost.
          </Alert>
        )}
        {confirm?.kind === 'squash' && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <>
                <Button color="inherit" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button color="inherit" disabled={busy} onClick={act}>
                  Squash
                </Button>
              </>
            }
          >
            Squash the history to {confirm.keep} version
            {confirm.keep === 1 ? '' : 's'}? Older versions are merged away; a
            copy of the vault is kept next to it (a <code>.squashed.</code>{' '}
            snapshot).
          </Alert>
        )}
        {versions && versions.length === 0 && (
          <Typography color="text.secondary">No versions yet.</Typography>
        )}
        {versions && versions.length > 0 && (
          <Table size="small" aria-label="Versions">
            <TableHead>
              <TableRow>
                <TableCell>Version</TableCell>
                <TableCell>Saved</TableCell>
                <TableCell>Message</TableCell>
                <TableCell>Keys</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {versions.map((v) => (
                <TableRow key={v.n}>
                  <TableCell>
                    v{v.n}
                    {v.isActive && (
                      <Chip size="small" label="current" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell>{new Date(v.created).toLocaleString()}</TableCell>
                  <TableCell sx={{ wordBreak: 'break-word' }}>
                    {v.message || '—'}
                  </TableCell>
                  <TableCell>
                    {v.keyCount} {keyDiff(v)}
                  </TableCell>
                  <TableCell align="right">
                    {!v.isActive && (
                      <Button
                        size="small"
                        aria-label={`Roll back to v${v.n}`}
                        onClick={() => setConfirm({ kind: 'rollback', n: v.n })}
                      >
                        Roll back
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        {versions && versions.length > 1 && (
          <>
            <TextField
              id="env-squash-keep"
              type="number"
              size="small"
              label="Keep"
              value={keep}
              onChange={(e) =>
                setKeep(Math.max(1, Math.floor(Number(e.target.value) || 1)))
              }
              inputProps={{ min: 1, max: versions.length - 1 }}
              sx={{ width: 110, mr: 'auto', ml: 2 }}
            />
            <Button
              color="warning"
              disabled={keep >= versions.length}
              onClick={() => setConfirm({ kind: 'squash', keep })}
            >
              Squash…
            </Button>
          </>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
