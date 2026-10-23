import { useCallback, useEffect, useRef, useState } from 'react';
import { envApi } from './envApi';
import EnvHistoryDialog from './EnvHistoryDialog';
import EnvBulkEditDialog from './EnvBulkEditDialog';
import EnvImportDialog from './EnvImportDialog';
import { EnvCompareDialog, EnvValidateDialog } from './EnvCheckDialogs';
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
  'changes. Saving still works: it merges your edit, or says which keys ' +
  'conflict. Your edit is kept.';
const LIMIT_MESSAGE =
  'This environment has reached its version limit: squash its history ' +
  '(History), then save again.';
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
  externalChange = 0,
  quietReload = 0,
  // A vault from a newer SecureVault (New-29): every write is refused, so
  // the controls that write aren't offered.
  readOnly = false,
}) => {
  const api = envApi();
  const [view, setView] = useState(null); // { viewId, revision, vars }
  const [revealed, setRevealed] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const [editing, setEditing] = useState(null); // { key, value, sensitive, comment, isNew }
  const [toDelete, setToDelete] = useState(null);
  const [selected, setSelected] = useState([]);
  const [transfer, setTransfer] = useState(null); // { keys, mode }
  const [menu, setMenu] = useState(null); // { anchor, row }
  const [fullValue, setFullValue] = useState(null); // { key, value }
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [envMenu, setEnvMenu] = useState(null); // anchor of the More menu
  const [importPreview, setImportPreview] = useState(null);
  const [check, setCheck] = useState(null); // 'compare' | 'validate'
  const [conflict, setConflict] = useState(null); // the CONFLICT result of a one-key save
  const viewIdRef = useRef(null);

  const handleFailure = useCallback(
    (result) => {
      if (result.code === 'LOCKED') onLocked(result);
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

  // The file changed outside the app (Task 16): reload what's shown, unless
  // the user is in the middle of something; then say so and keep it.
  const busyRef = useRef(false);
  busyRef.current =
    editing !== null ||
    toDelete !== null ||
    transfer !== null ||
    historyOpen ||
    bulkOpen ||
    importPreview !== null ||
    selected.length > 0;
  const seenChange = useRef(externalChange);
  useEffect(() => {
    if (externalChange === seenChange.current) return;
    seenChange.current = externalChange;
    const viewId = viewIdRef.current;
    if (!viewId) return;
    if (busyRef.current) {
      setStale(true);
      return;
    }
    api.refresh(vaultId, viewId).then((result) => {
      if (viewIdRef.current !== viewId) return;
      showRef.current(result);
      if (result.success)
        setNotice('Updated with a change made outside the app.');
    });
  }, [api, vaultId, externalChange]);

  // The app rewrote the file itself (a password change): follow it quietly.
  const seenQuiet = useRef(quietReload);
  useEffect(() => {
    if (quietReload === seenQuiet.current) return;
    seenQuiet.current = quietReload;
    const viewId = viewIdRef.current;
    if (!viewId) return;
    api.refresh(vaultId, viewId).then((result) => {
      if (viewIdRef.current === viewId) showRef.current(result);
    });
  }, [api, vaultId, quietReload]);

  const loadHistory = useCallback(
    () => api.history(vaultId, viewIdRef.current),
    [api, vaultId]
  );

  const runHistory = async (action) => {
    const result =
      action.kind === 'rollback'
        ? await api.rollback(vaultId, view.viewId, action.n)
        : await api.squash(vaultId, view.viewId, action.keep);
    if (!result.success && ['LOCKED', 'STALE'].includes(result.code)) {
      setHistoryOpen(false);
      handleFailure(result);
    }
    return result;
  };

  const historyDone = async (message) => {
    setHistoryOpen(false);
    setNotice(message);
    show(await api.refresh(vaultId, view.viewId));
    onChanged();
  };

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

  /** @param {'dotenv'|'json'} [format] */
  const exportEnv = async (format = 'dotenv') => {
    setEnvMenu(null);
    const result = await api.exportEnv(vaultId, env, format);
    if (result.canceled) return;
    if (!result.success) return handleFailure(result);
    setNotice(`Exported ${env} to ${result.path}`);
  };

  /**
   * Save a changeset; resolves to the result. A CONFLICT or LIMIT is left
   * to the caller, which knows what the user was doing.
   */
  const save = async (ops, { force = false } = {}) => {
    const result = await api.commit(vaultId, {
      viewId: view.viewId,
      ops,
      force,
    });
    if (!result.success) {
      if (!['CONFLICT', 'LIMIT'].includes(result.code)) handleFailure(result);
      return result;
    }
    show(await api.refresh(vaultId, view.viewId));
    if (result.rebased) {
      setNotice('Saved, merged with a change made elsewhere.');
    }
    onChanged();
    return result;
  };

  const commit = async (ops, options) => {
    setBusy(true);
    try {
      const result = await save(ops, options);
      if (result.code === 'CONFLICT') setConflict(result);
      if (result.code === 'LIMIT') setError(LIMIT_MESSAGE);
      return result.success;
    } finally {
      setBusy(false);
    }
  };

  const loadText = useCallback(
    () => api.editText(vaultId, viewIdRef.current),
    [api, vaultId]
  );

  const exportTemplate = async () => {
    setEnvMenu(null);
    const result = await api.templateEnv(vaultId, env);
    if (result.canceled) return;
    if (!result.success) return handleFailure(result);
    setNotice(`Saved a template of ${env} to ${result.path}`);
  };

  const startImport = async () => {
    setEnvMenu(null);
    const result = await api.importPick(vaultId, view.viewId);
    if (result.canceled) return;
    if (!result.success) return handleFailure(result);
    setImportPreview(result);
  };

  const applyImport = async (options) => {
    const result = await api.importApply(vaultId, importPreview.token, options);
    if (!result.success) {
      if (['LOCKED', 'STALE'].includes(result.code)) {
        setImportPreview(null);
        handleFailure(result);
      }
      return result;
    }
    setImportPreview(null);
    setNotice(
      `Imported ${result.count} key${result.count === 1 ? '' : 's'} from ${importPreview.fileName}.`
    );
    show(await api.refresh(vaultId, view.viewId));
    onChanged();
    return result;
  };

  const cancelImport = () => {
    api.importCancel(vaultId, importPreview.token);
    setImportPreview(null);
  };

  const loadDiff = useCallback(
    (other, reveal) => api.diff(vaultId, env, other, { reveal }),
    [api, vaultId, env]
  );
  const loadValidate = useCallback(
    () => api.validate(vaultId, env),
    [api, vaultId, env]
  );

  const bulkDone = (result, count) => {
    setBulkOpen(false);
    setNotice(
      `Saved ${count} change${count === 1 ? '' : 's'}${result.rebased ? ', merged with a change made elsewhere' : ''}.`
    );
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

  const saveEdit = async (force = false) => {
    const { key, value, sensitive, comment } = editing;
    const op = { op: 'set', key: key.trim(), value, sensitive, comment };
    setConflict(null);
    if (await commit([op], { force })) {
      setEditing(null);
    }
  };

  const confirmDelete = async () => {
    setConflict(null);
    if (await commit([{ op: 'rm', key: toDelete }])) setToDelete(null);
  };

  // A conflict belongs to the dialog it came from.
  useEffect(() => {
    if (editing === null && toDelete === null) setConflict(null);
  }, [editing, toDelete]);

  const conflictAlert = conflict && (
    <Alert
      severity="warning"
      sx={{ mb: 2 }}
      action={
        editing && conflict.conflicts?.[0]?.kind !== 'env-gone' ? (
          <Button
            color="inherit"
            disabled={busy}
            onClick={() => saveEdit(true)}
          >
            Overwrite
          </Button>
        ) : null
      }
    >
      {conflict.error}. Reload to see it, or overwrite with yours.
    </Alert>
  );

  // Editing starts from the current value, so a masked one is revealed
  // first: saving an untouched field must not wipe the secret.
  const startEdit = async (row) => {
    let value = row.sensitive ? revealed[row.key] : row.value;
    if (value === undefined) {
      const result = await api.reveal(vaultId, view.viewId, row.key);
      if (!result.success) return handleFailure(result);
      value = result.value;
    }
    setEditing({
      key: row.key,
      value,
      sensitive: row.sensitive,
      comment: row.comment ?? '',
      isNew: false,
    });
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
        {!readOnly && (
          <Button variant="outlined" onClick={() => setBulkOpen(true)}>
            Edit as .env
          </Button>
        )}
        <Button variant="outlined" onClick={() => setHistoryOpen(true)}>
          History
        </Button>
        <Button variant="outlined" onClick={() => exportEnv()}>
          Export .env
        </Button>
        <Button
          variant="outlined"
          aria-label="More environment actions"
          onClick={(e) => setEnvMenu(e.currentTarget)}
        >
          <MoreIcon fontSize="small" />
        </Button>
        {!readOnly && (
          <Button
            variant="outlined"
            onClick={() =>
              setEditing({
                key: '',
                value: '',
                sensitive: true,
                comment: '',
                isNew: true,
              })
            }
          >
            Add variable
          </Button>
        )}
      </Box>

      {selected.length > 0 && !readOnly && (
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
                  disabled={readOnly}
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
                      disabled={readOnly}
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
                    {row.comment && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        data-testid={`comment-${row.key}`}
                        sx={{
                          display: 'block',
                          fontFamily: 'inherit',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {row.comment}
                      </Typography>
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
                    {!readOnly && (
                      <Tooltip title={row.inheritedFrom ? 'Override' : 'Edit'}>
                        <IconButton
                          size="small"
                          aria-label={`Edit ${row.key}`}
                          onClick={() => startEdit(row)}
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                    {!readOnly && !row.inheritedFrom && (
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
        {!readOnly && (
          <MenuItem onClick={() => openTransfer([menu.row.key], 'copy')}>
            Copy to environment…
          </MenuItem>
        )}
        {menu && !readOnly && !menu.row.inheritedFrom && (
          <MenuItem onClick={() => openTransfer([menu.row.key], 'move')}>
            Move to environment…
          </MenuItem>
        )}
      </Menu>

      <Menu
        anchorEl={envMenu}
        open={envMenu !== null}
        onClose={() => setEnvMenu(null)}
      >
        {!readOnly && <MenuItem onClick={startImport}>Import .env…</MenuItem>}
        <MenuItem onClick={() => exportEnv('json')}>Export as JSON…</MenuItem>
        <MenuItem onClick={exportTemplate}>
          Save template (.env.example)…
        </MenuItem>
        <MenuItem
          onClick={() => {
            setEnvMenu(null);
            setCheck('compare');
          }}
        >
          Compare with…
        </MenuItem>
        <MenuItem
          onClick={() => {
            setEnvMenu(null);
            setCheck('validate');
          }}
        >
          Validate
        </MenuItem>
      </Menu>

      {importPreview && (
        <EnvImportDialog
          env={env}
          preview={importPreview}
          apply={applyImport}
          onClose={cancelImport}
        />
      )}
      {check === 'compare' && (
        <EnvCompareDialog
          env={env}
          otherEnvs={otherEnvs}
          load={loadDiff}
          onClose={() => setCheck(null)}
        />
      )}
      {check === 'validate' && (
        <EnvValidateDialog
          env={env}
          load={loadValidate}
          onClose={() => setCheck(null)}
        />
      )}

      {bulkOpen && (
        <EnvBulkEditDialog
          env={env}
          load={loadText}
          save={save}
          onDone={bulkDone}
          onOpenHistory={() => {
            setBulkOpen(false);
            setHistoryOpen(true);
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {historyOpen && (
        <EnvHistoryDialog
          env={env}
          load={loadHistory}
          run={runHistory}
          readOnly={readOnly}
          onDone={historyDone}
          onClose={() => setHistoryOpen(false)}
        />
      )}

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
        onClose={() => {
          setEditing(null);
          setConflict(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {editing?.isNew ? 'Add variable' : `Edit ${editing?.key}`}
        </DialogTitle>
        <DialogContent>
          {stale && !conflict && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {STALE_MESSAGE}
            </Alert>
          )}
          {conflictAlert}
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
          <TextField
            id="env-var-comment"
            label="Comment (optional)"
            helperText="Shown next to the key, never masked: don't put secrets here."
            value={editing?.comment ?? ''}
            onChange={(e) =>
              setEditing({ ...editing, comment: e.target.value })
            }
            fullWidth
            margin="dense"
            multiline
            maxRows={4}
            inputProps={{ maxLength: 1000 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          {stale && <Button onClick={reload}>Reload</Button>}
          <Button
            variant="contained"
            onClick={() => saveEdit()}
            disabled={busy || !editing?.key?.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={toDelete !== null} onClose={() => setToDelete(null)}>
        <DialogTitle>Delete {toDelete}?</DialogTitle>
        <DialogContent>
          {conflictAlert}
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
