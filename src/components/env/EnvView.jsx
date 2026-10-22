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
  Menu,
  MenuItem,
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
  ContentCopy as CopyIcon,
  MoreVert as MoreIcon,
} from '@mui/icons-material';

const MASK = '••••••••';
const STALE_MESSAGE =
  'This vault was changed elsewhere since you opened it. Reload to see the ' +
  'changes, then try again. Your edit is kept.';
/** Longer values (or multi-line ones) are cut in the table; "Show" opens them. */
export const LONG_VALUE = 80;

const isLong = (value) =>
  typeof value === 'string' &&
  (value.length > LONG_VALUE || value.includes('\n'));
const shorten = (value) => `${value.split('\n')[0].slice(0, LONG_VALUE - 20)}…`;

/** Copy or move keys to another env; CONFLICT offers to overwrite. */
function TransferDialog({ request, envs, onSubmit, onClose }) {
  const [target, setTarget] = useState(envs[0] ?? '');
  const [conflict, setConflict] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const verb = request.mode === 'move' ? 'Move' : 'Copy';

  const submit = async (overwrite) => {
    setBusy(true);
    const result = await onSubmit({ target, overwrite });
    setBusy(false);
    if (result.success) return;
    if (result.code === 'CONFLICT') setConflict(result.error);
    else setError(result.error || 'Something went wrong');
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {verb}{' '}
        {request.keys.length === 1
          ? request.keys[0]
          : `${request.keys.length} keys`}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {conflict && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {conflict}. Overwrite them?
          </Alert>
        )}
        {envs.length === 0 ? (
          <Typography>There is no other environment in this vault.</Typography>
        ) : (
          <TextField
            id="env-transfer-target"
            select
            label="To environment"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setConflict('');
            }}
            fullWidth
            margin="dense"
          >
            {envs.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {conflict ? (
          <Button
            variant="contained"
            color="warning"
            disabled={busy}
            onClick={() => submit(true)}
          >
            Overwrite
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={busy || !target}
            onClick={() => submit(false)}
          >
            {verb}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/**
 * One environment's variables (GUI-ENV-RFC §6.9). Sensitive values arrive
 * masked; Reveal fetches one value from main. Copy and Export run in main,
 * so they never bring a value into the page. Every edit is a changeset
 * against the revision on screen: if the file changed meanwhile, main
 * answers STALE and the draft stays until the user reloads.
 *
 * Revealed values live only in this component's state, which is dropped on
 * unmount (env switch, back, lock).
 */
const EnvView = ({
  vaultId,
  env,
  onLocked,
  otherEnvs = [],
  onChanged = () => {},
}) => {
  const api = envApi();
  const [view, setView] = useState(null); // { viewId, revision, vars }
  const [revealed, setRevealed] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const [editing, setEditing] = useState(null); // { key, value, sensitive, isNew }
  const [toDelete, setToDelete] = useState(null);
  const [selected, setSelected] = useState([]);
  const [transfer, setTransfer] = useState(null); // { keys, mode }
  const [menu, setMenu] = useState(null); // { anchor, row }
  const [fullValue, setFullValue] = useState(null); // { key, value }
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
      setSelected([]);
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
    api.view(vaultId, env).then((result) => {
      if (active) showRef.current(result);
      // This mount is gone (StrictMode, a fast env switch): free its view.
      else if (result.success) api.closeView(vaultId, result.viewId);
    });
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

  const copy = async (key, format = 'value') => {
    setMenu(null);
    const result = await api.copy(vaultId, view.viewId, key, format);
    if (!result.success) return handleFailure(result);
    const what =
      format === 'key' ? 'the key name' : format === 'pair' ? `${key}=…` : key;
    setNotice(
      result.clearsInMs
        ? `Copied ${what}. It is cleared from the clipboard in ${Math.round(result.clearsInMs / 1000)} s.`
        : `Copied ${what}.`
    );
  };

  const exportEnv = async () => {
    const result = await api.exportEnv(vaultId, env);
    if (result.canceled) return;
    if (!result.success) return handleFailure(result);
    setNotice(`Exported ${env} to ${result.path}`);
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
      onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const runTransfer = async ({ target, overwrite }) => {
    const { keys, mode } = transfer;
    const result = await api.transfer(vaultId, {
      viewId: view.viewId,
      keys,
      target,
      mode,
      overwrite,
    });
    if (!result.success) {
      if (result.code === 'LOCKED' || result.code === 'STALE') {
        setTransfer(null);
        handleFailure(result);
      }
      return result;
    }
    setNotice(
      `${mode === 'move' ? 'Moved' : 'Copied'} ${keys.length === 1 ? keys[0] : `${keys.length} keys`} to ${target}.`
    );
    setTransfer(null);
    show(await api.refresh(vaultId, view.viewId));
    onChanged();
    return result;
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

  const toggleSelected = (key) =>
    setSelected((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key]
    );

  const openTransfer = (keys, mode) => {
    setMenu(null);
    setTransfer({ keys, mode });
  };

  if (!view) {
    return error ? <Alert severity="error">{error}</Alert> : null;
  }

  // Inherited keys can be copied elsewhere but not moved out of this env.
  const canMoveSelection = view.vars
    .filter((r) => selected.includes(r.key))
    .every((r) => !r.inheritedFrom);
  const allSelected =
    view.vars.length > 0 && selected.length === view.vars.length;

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
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {env}
        </Typography>
        <Button variant="outlined" onClick={exportEnv}>
          Export .env
        </Button>
        <Button
          variant="outlined"
          onClick={() =>
            setEditing({ key: '', value: '', sensitive: true, isNew: true })
          }
        >
          Add variable
        </Button>
      </Box>

      {selected.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography sx={{ flexGrow: 1 }}>
            {selected.length} selected
          </Typography>
          <Button size="small" onClick={() => openTransfer(selected, 'copy')}>
            Copy to…
          </Button>
          <Tooltip
            title={canMoveSelection ? '' : 'Inherited keys can only be copied'}
          >
            <span>
              <Button
                size="small"
                disabled={!canMoveSelection}
                onClick={() => openTransfer(selected, 'move')}
              >
                Move to…
              </Button>
            </span>
          </Tooltip>
          <Button size="small" onClick={() => setSelected([])}>
            Clear
          </Button>
        </Box>
      )}

      {view.vars.length === 0 ? (
        <Typography color="text.secondary">No variables yet.</Typography>
      ) : (
        <Table
          size="small"
          aria-label="Variables"
          sx={{ tableLayout: 'fixed' }}
        >
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={selected.length > 0 && !allSelected}
                  onChange={() =>
                    setSelected(allSelected ? [] : view.vars.map((r) => r.key))
                  }
                  inputProps={{ 'aria-label': 'Select all' }}
                />
              </TableCell>
              <TableCell sx={{ width: '32%' }}>Key</TableCell>
              <TableCell>Value</TableCell>
              <TableCell align="right" sx={{ width: 200 }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {view.vars.map((row) => {
              const value =
                row.key in revealed
                  ? revealed[row.key]
                  : row.sensitive
                    ? null
                    : row.value;
              return (
                <TableRow
                  key={row.key}
                  sx={row.inheritedFrom ? { opacity: 0.6 } : undefined}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected.includes(row.key)}
                      onChange={() => toggleSelected(row.key)}
                      inputProps={{ 'aria-label': `Select ${row.key}` }}
                    />
                  </TableCell>
                  <TableCell
                    sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                  >
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
                    {value === null
                      ? MASK
                      : isLong(value)
                        ? shorten(value)
                        : value}
                    {value !== null && isLong(value) && (
                      <Button
                        size="small"
                        sx={{ ml: 1 }}
                        aria-label={`Show all of ${row.key}`}
                        onClick={() => setFullValue({ key: row.key, value })}
                      >
                        Show
                      </Button>
                    )}
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
                    <Tooltip title="Copy value">
                      <IconButton
                        size="small"
                        aria-label={`Copy ${row.key}`}
                        onClick={() => copy(row.key)}
                      >
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
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
                    <IconButton
                      size="small"
                      aria-label={`More actions for ${row.key}`}
                      onClick={(e) => setMenu({ anchor: e.currentTarget, row })}
                    >
                      <MoreIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Menu
        anchorEl={menu?.anchor ?? null}
        open={menu !== null}
        onClose={() => setMenu(null)}
      >
        <MenuItem onClick={() => copy(menu.row.key, 'key')}>
          Copy key name
        </MenuItem>
        <MenuItem onClick={() => copy(menu.row.key, 'pair')}>
          Copy KEY=value
        </MenuItem>
        <MenuItem onClick={() => openTransfer([menu.row.key], 'copy')}>
          Copy to environment…
        </MenuItem>
        {menu && !menu.row.inheritedFrom && (
          <MenuItem onClick={() => openTransfer([menu.row.key], 'move')}>
            Move to environment…
          </MenuItem>
        )}
      </Menu>

      {transfer && (
        <TransferDialog
          request={transfer}
          envs={otherEnvs}
          onSubmit={runTransfer}
          onClose={() => setTransfer(null)}
        />
      )}

      <Dialog
        open={fullValue !== null}
        onClose={() => setFullValue(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ fontFamily: 'monospace' }}>
          {fullValue?.key}
        </DialogTitle>
        <DialogContent>
          <Box
            component="pre"
            data-testid="full-value"
            sx={{
              m: 0,
              p: 1,
              maxHeight: '60vh',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontFamily: 'monospace',
              fontSize: 13,
              bgcolor: 'action.hover',
              borderRadius: 1,
            }}
          >
            {fullValue?.value}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => copy(fullValue.key)}>Copy</Button>
          <Button onClick={() => setFullValue(null)}>Close</Button>
        </DialogActions>
      </Dialog>

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
            maxRows={12}
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
