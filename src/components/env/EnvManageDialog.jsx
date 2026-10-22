import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const TITLES = {
  rename: 'Rename',
  duplicate: 'Duplicate',
  describe: 'Description of',
  extends: 'Parent of',
  delete: 'Delete',
};

/**
 * One change to an env itself (GUI-ENV-BREAKDOWN Task 24). `request` is
 * `{ op, env }` plus the env's current `description` and `extends`.
 * `onSubmit(fields)` resolves to the IPC result; a failure stays in the
 * dialog. `loadReferences()` resolves to `env:references` for `env`: a
 * rename offers to update them (New-30).
 */
export default function EnvManageDialog({
  request,
  envNames,
  onSubmit,
  onClose,
  loadReferences = null,
}) {
  const { op, env } = request;
  const [name, setName] = useState(op === 'duplicate' ? `${env}-copy` : env);
  const [description, setDescription] = useState(request.description ?? '');
  const [parent, setParent] = useState(request.extends ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // null while loading; then the envs that refer to `env`, or an error.
  const [references, setReferences] = useState(null);
  const [updateReferences, setUpdateReferences] = useState(true);

  useEffect(() => {
    if (op !== 'rename' || !loadReferences) return undefined;
    let active = true;
    loadReferences().then((result) => {
      if (!active) return;
      setReferences(
        result.success ? { list: result.references } : { error: true }
      );
    });
    return () => {
      active = false;
    };
  }, [op, loadReferences]);

  const referenceCount = (references?.list ?? []).reduce(
    (sum, r) => sum + r.count,
    0
  );

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    const result = await onSubmit({
      op,
      env,
      name: name.trim(),
      description,
      parent: parent || null,
      updateReferences: referenceCount > 0 && updateReferences,
    });
    setBusy(false);
    if (!result.success) setError(result.error || 'Something went wrong');
  };

  const unchanged =
    (op === 'rename' && name.trim() === env) ||
    ((op === 'rename' || op === 'duplicate') && !name.trim());

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={submit}>
        <DialogTitle>
          {TITLES[op]} {env}
          {op === 'delete' ? '?' : ''}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {(op === 'rename' || op === 'duplicate') && (
            <TextField
              id="env-manage-name"
              label="New name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              margin="dense"
              autoFocus
              helperText={
                op === 'rename'
                  ? 'Environments that extend it follow.'
                  : 'Copies the current variables, flags and comments; history starts fresh.'
              }
            />
          )}
          {op === 'rename' && referenceCount > 0 && (
            <FormControlLabel
              sx={{ mt: 1 }}
              control={
                <Checkbox
                  checked={updateReferences}
                  onChange={(e) => setUpdateReferences(e.target.checked)}
                />
              }
              label={`Update ${plural(
                referenceCount,
                'reference',
                'references'
              )} to ${env} in ${references.list.map((r) => r.env).join(', ')}`}
            />
          )}
          {op === 'rename' && referenceCount > 0 && !updateReferences && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {
                'They will point to an environment that no longer exists, and exports and runs that use them will fail.'
              }
            </Alert>
          )}
          {op === 'rename' && references?.error && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {
                "References like {{env:NAME/KEY}} couldn't be checked and won't be updated."
              }
            </Typography>
          )}
          {op === 'describe' && (
            <TextField
              id="env-manage-description"
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              margin="dense"
              multiline
              maxRows={4}
              autoFocus
              inputProps={{ maxLength: 500 }}
            />
          )}
          {op === 'extends' && (
            <TextField
              id="env-manage-parent"
              select
              label="Parent environment"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              fullWidth
              margin="dense"
              helperText="Its variables show here unless this environment sets them."
            >
              <MenuItem value="">None</MenuItem>
              {envNames
                .filter((n) => n !== env)
                .map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
            </TextField>
          )}
          {op === 'delete' && (
            <Typography>
              {env} and all its versions are removed. A copy of the vault is
              kept next to it (a <code>.deleted.</code> snapshot).
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            color={op === 'delete' ? 'error' : 'primary'}
            disabled={
              busy ||
              unchanged ||
              (op === 'rename' && Boolean(loadReferences) && !references)
            }
          >
            {op === 'delete' ? 'Delete' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
