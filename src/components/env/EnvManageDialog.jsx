import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';

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
 * dialog.
 */
export default function EnvManageDialog({
  request,
  envNames,
  onSubmit,
  onClose,
}) {
  const { op, env } = request;
  const [name, setName] = useState(op === 'duplicate' ? `${env}-copy` : env);
  const [description, setDescription] = useState(request.description ?? '');
  const [parent, setParent] = useState(request.extends ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    const result = await onSubmit({
      op,
      env,
      name: name.trim(),
      description,
      parent: parent || null,
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
                  ? 'Environments that extend it follow. References like {{env:NAME/KEY}} are not updated.'
                  : 'Copies the current variables, flags and comments; history starts fresh.'
              }
            />
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
            disabled={busy || unchanged}
          >
            {op === 'delete' ? 'Delete' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
