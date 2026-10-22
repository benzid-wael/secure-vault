import { useCallback, useEffect, useRef, useState } from 'react';
import { envApi } from './envApi';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Visibility as RevealIcon,
  VisibilityOff as HideIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';

const MASK = '••••••••';
const STALE_MESSAGE =
  'This vault was changed elsewhere since you opened it. Reload to see the ' +
  'changes, then save again. Your edit is kept.';

/**
 * One environment's variables (GUI-ENV-RFC §6.9). Sensitive values arrive
 * masked; Reveal fetches one value from main. Every edit is a one-op
 * changeset against the revision on screen: if the file changed meanwhile,
 * main answers STALE and the draft stays until the user reloads.
 *
 * Revealed values live only in this component's state, which is dropped on
 * unmount (env switch, back, lock).
 */
const EnvView = ({ vaultId, env, onLocked }) => {
  const api = envApi();
  const [view, setView] = useState(null); // { viewId, revision, vars }
  const [revealed, setRevealed] = useState({});
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [editing, setEditing] = useState(null); // { key, value, sensitive, isNew }
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const viewIdRef = useRef(null);

  const handleFailure = useCallback(
    (result) => {
      if (result.code === 'LOCKED') onLocked();
      else if (result.code === 'STALE') setStale(true);
      else setError(result.error || 'Something went wrong');
    },
    [onLocked]
  );

  const show = useCallback(
    (result) => {
      if (!result.success) return handleFailure(result);
      viewIdRef.current = result.viewId;
      setView(result);
      setRevealed({});
      setStale(false);
      setError('');
    },
    [handleFailure]
  );

  // The latest `show`, so a new `onLocked` from the parent doesn't reopen
  // the view.
  const showRef = useRef(show);
  showRef.current = show;

  useEffect(() => {
    let active = true;
    api.view(vaultId, env).then((result) => active && showRef.current(result));
    return () => {
      active = false;
      const viewId = viewIdRef.current;
      viewIdRef.current = null;
      if (viewId) api.closeView(vaultId, viewId);
    };
  }, [api, vaultId, env]);

  const reload = async () => show(await api.refresh(vaultId, view.viewId));

  const toggleReveal = async (key) => {
    if (key in revealed) {
      const rest = { ...revealed };
      delete rest[key];
      setRevealed(rest);
      return;
    }
    const result = await api.reveal(vaultId, view.viewId, key);
    if (!result.success) return handleFailure(result);
    setRevealed((current) => ({ ...current, [key]: result.value }));
  };

  const commit = async (ops) => {
    setBusy(true);
    try {
      const result = await api.commit(vaultId, { viewId: view.viewId, ops });
      if (!result.success) {
        handleFailure(result);
        return false;
      }
      show(await api.refresh(vaultId, view.viewId));
      return true;
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    const { key, value, sensitive } = editing;
    if (await commit([{ op: 'set', key: key.trim(), value, sensitive }])) {
      setEditing(null);
    }
  };

  const confirmDelete = async () => {
    if (await commit([{ op: 'rm', key: toDelete }])) setToDelete(null);
  };

  // Editing starts from the current value, so a masked one is revealed
  // first: saving an untouched field must not wipe the secret.
  const startEdit = async (row) => {
    let value = row.sensitive ? revealed[row.key] : row.value;
    if (value === undefined) {
      const result = await api.reveal(vaultId, view.viewId, row.key);
      if (!result.success) return handleFailure(result);
      value = result.value;
    }
    setEditing({ key: row.key, value, sensitive: row.sensitive, isNew: false });
  };

  if (!view) {
    return error ? <Alert severity="error">{error}</Alert> : null;
  }

  return (
    <Box>
      {stale && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={reload}>
              Reload
            </Button>
          }
        >
          {STALE_MESSAGE}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {env}
        </Typography>
        <Button
          variant="outlined"
          onClick={() =>
            setEditing({ key: '', value: '', sensitive: true, isNew: true })
          }
        >
          Add variable
        </Button>
      </Box>

      {view.vars.length === 0 ? (
        <Typography color="text.secondary">No variables yet.</Typography>
      ) : (
        <Table size="small" aria-label="Variables">
          <TableHead>
            <TableRow>
              <TableCell>Key</TableCell>
              <TableCell>Value</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {view.vars.map((row) => {
              const shown =
                row.key in revealed
                  ? revealed[row.key]
                  : row.sensitive
                    ? MASK
                    : row.value;
              return (
                <TableRow
                  key={row.key}
                  sx={row.inheritedFrom ? { opacity: 0.6 } : undefined}
                >
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    {row.key}
                    {row.inheritedFrom && (
                      <Chip
                        size="small"
                        label={`from ${row.inheritedFrom}`}
                        sx={{ ml: 1 }}
                      />
                    )}
                  </TableCell>
                  <TableCell
                    sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                    data-testid={`value-${row.key}`}
                  >
                    {shown}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {row.sensitive && (
                      <Tooltip title={row.key in revealed ? 'Hide' : 'Reveal'}>
                        <IconButton
                          size="small"
                          aria-label={`${row.key in revealed ? 'Hide' : 'Reveal'} ${row.key}`}
                          onClick={() => toggleReveal(row.key)}
                        >
                          {row.key in revealed ? <HideIcon /> : <RevealIcon />}
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={row.inheritedFrom ? 'Override' : 'Edit'}>
                      <IconButton
                        size="small"
                        aria-label={`Edit ${row.key}`}
                        onClick={() => startEdit(row)}
                      >
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    {!row.inheritedFrom && (
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          aria-label={`Delete ${row.key}`}
                          onClick={() => setToDelete(row.key)}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {editing?.isNew ? 'Add variable' : `Edit ${editing?.key}`}
        </DialogTitle>
        <DialogContent>
          {stale && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {STALE_MESSAGE}
            </Alert>
          )}
          {editing?.isNew && (
            <TextField
              id="env-var-key"
              label="Key"
              value={editing.key}
              onChange={(e) => setEditing({ ...editing, key: e.target.value })}
              fullWidth
              margin="dense"
              autoFocus
            />
          )}
          <TextField
            id="env-var-value"
            label="Value"
            value={editing?.value ?? ''}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            fullWidth
            margin="dense"
            multiline
            autoFocus={!editing?.isNew}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={editing?.sensitive ?? true}
                onChange={(e) =>
                  setEditing({ ...editing, sensitive: e.target.checked })
                }
              />
            }
            label="Secret (masked)"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          {stale && <Button onClick={reload}>Reload</Button>}
          <Button
            variant="contained"
            onClick={saveEdit}
            disabled={busy || !editing?.key?.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={toDelete !== null} onClose={() => setToDelete(null)}>
        <DialogTitle>Delete {toDelete}?</DialogTitle>
        <DialogContent>
          <Typography>
            This adds a new version without {toDelete}. Earlier versions keep
            it.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={confirmDelete}
            disabled={busy}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EnvView;
