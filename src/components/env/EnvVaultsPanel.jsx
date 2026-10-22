import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  FolderOpen as OpenIcon,
  Lock as LockIcon,
  ArrowBack as BackIcon,
} from '@mui/icons-material';
import EnvView from './EnvView';
import { envApi } from './envApi';

/** Unlock or create: the password goes to main once and isn't kept here. */
function PasswordDialog({ title, withName = false, onSubmit, onClose }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (withName && password !== confirm) {
      setError('The passwords do not match');
      return;
    }
    setBusy(true);
    const result = await onSubmit({ name, password });
    setBusy(false);
    if (!result.success) setError(result.error || 'Something went wrong');
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={submit}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {withName && (
            <TextField
              id="env-vault-name"
              label="Vault Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              margin="dense"
              autoFocus
            />
          )}
          <TextField
            id="env-vault-password"
            label="Vault Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            margin="dense"
            autoFocus={!withName}
          />
          {withName && (
            <TextField
              id="env-vault-password-confirm"
              label="Confirm Password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              fullWidth
              margin="dense"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {withName ? 'Create' : 'Unlock'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** One unlocked vault: its environments on the left, the selected one right. */
function EnvVaultScreen({ vault, onBack, onLock, onLocked }) {
  const api = envApi();
  const [envs, setEnvs] = useState(null);
  const [revision, setRevision] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newEnv, setNewEnv] = useState('');

  const load = useCallback(async () => {
    const result = await api.listEnvs(vault.id);
    if (!result.success) {
      if (result.code === 'LOCKED') onLocked();
      else setError(result.error);
      return;
    }
    setEnvs(result.envs);
    setRevision(result.revision);
    setSelected((current) => current ?? result.envs[0]?.name ?? null);
  }, [api, vault.id, onLocked]);

  useEffect(() => {
    load();
  }, [load]);

  const createEnv = async (event) => {
    event.preventDefault();
    const result = await api.createEnv(vault.id, newEnv.trim(), revision);
    if (!result.success) {
      if (result.code === 'LOCKED') return onLocked();
      setError(
        result.code === 'STALE'
          ? 'This vault was changed elsewhere; the list is reloaded, try again'
          : result.error
      );
      load();
      return;
    }
    setCreating(false);
    setSelected(newEnv.trim());
    setNewEnv('');
    load();
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Button startIcon={<BackIcon />} onClick={onBack}>
          Vaults
        </Button>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          {vault.label}
        </Typography>
        <Button startIcon={<LockIcon />} variant="outlined" onClick={onLock}>
          Lock
        </Button>
      </Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <Paper sx={{ width: 240, flexShrink: 0 }}>
          <List dense aria-label="Environments">
            {(envs || []).map((env) => (
              <ListItemButton
                key={env.name}
                selected={env.name === selected}
                onClick={() => setSelected(env.name)}
              >
                <ListItemText
                  primary={env.name}
                  secondary={`${env.varCount} variables`}
                />
              </ListItemButton>
            ))}
          </List>
          <Box sx={{ p: 1 }}>
            <Button
              fullWidth
              startIcon={<AddIcon />}
              onClick={() => setCreating(true)}
            >
              New environment
            </Button>
          </Box>
        </Paper>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          {envs && envs.length === 0 && (
            <Typography color="text.secondary">
              This vault has no environments yet. Create one to add variables.
            </Typography>
          )}
          {selected && (
            <EnvView
              key={`${vault.id}:${selected}`}
              vaultId={vault.id}
              env={selected}
              onLocked={onLocked}
              otherEnvs={(envs || [])
                .map((e) => e.name)
                .filter((name) => name !== selected)}
              onChanged={load}
            />
          )}
        </Box>
      </Box>

      <Dialog open={creating} onClose={() => setCreating(false)}>
        <form onSubmit={createEnv}>
          <DialogTitle>New environment</DialogTitle>
          <DialogContent>
            <TextField
              id="env-name"
              label="Environment Name"
              value={newEnv}
              onChange={(e) => setNewEnv(e.target.value)}
              fullWidth
              margin="dense"
              autoFocus
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={!newEnv.trim()}>
              Create
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}

/**
 * The Environments side of the selector (GUI-ENV-RFC §6.9): env vaults in
 * the app folder plus ones opened this run, with Open…, New… and unlock.
 * Rendered only behind the New-4 gate. `header` (the Passwords |
 * Environments switch) shows on the list only.
 */
const EnvVaultsPanel = ({ header = null }) => {
  const api = envApi();
  const [vaults, setVaults] = useState([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { kind: 'unlock', vault } | { kind: 'create' }
  const [openVault, setOpenVault] = useState(null);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const result = await api.list();
    if (result.success) setVaults(result.vaults);
    else setError(result.error);
    return result.success ? result.vaults : [];
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onLocked = useCallback(() => {
    setOpenVault(null);
    setNotice('The vault was locked.');
    refresh();
  }, [refresh]);

  // Main locked a vault (idle, sleep, screen lock): drop everything for it.
  const openIdRef = useRef(null);
  openIdRef.current = openVault?.id ?? null;
  useEffect(
    () =>
      api.onLocked(({ id }) => {
        if (openIdRef.current === id) onLocked();
        else refresh();
      }),
    [api, onLocked, refresh]
  );

  const enter = async (id) => {
    const listed = await refresh();
    setOpenVault(listed.find((v) => v.id === id) ?? null);
    setDialog(null);
    setNotice('');
  };

  const select = (vault) =>
    vault.unlocked ? enter(vault.id) : setDialog({ kind: 'unlock', vault });

  const openFromDisk = async () => {
    const result = await api.open();
    if (result.canceled) return;
    if (!result.success) return setError(result.error);
    const listed = await refresh();
    const vault = listed.find((v) => v.id === result.id);
    if (vault) select(vault);
  };

  const unlock = async ({ password }) => {
    const result = await api.unlock(dialog.vault.id, password);
    if (result.success) await enter(dialog.vault.id);
    return result;
  };

  const create = async ({ name, password }) => {
    const result = await api.create({ mode: 'appdata', name }, password);
    if (result.success) await enter(result.id);
    return result;
  };

  const lock = async () => {
    await api.lock(openVault.id);
    setOpenVault(null);
    refresh();
  };

  if (openVault) {
    return (
      <EnvVaultScreen
        vault={openVault}
        onBack={() => setOpenVault(null)}
        onLock={lock}
        onLocked={onLocked}
      />
    );
  }

  return (
    <div className="vault-container">
      {header}
      <Typography variant="h6" sx={{ color: 'white', mb: 2 }}>
        Environment Vaults
      </Typography>
      {notice && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {vaults.length === 0 && (
        <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 2 }}>
          No environment vaults in the app folder. Open a project&apos;s
          .env.vault, or create a new one.
        </Typography>
      )}
      <div className="vault-list">
        {vaults.map((vault) => (
          <Card
            key={vault.id}
            className="vault-item"
            sx={{ cursor: vault.exists ? 'pointer' : 'default', mb: 1 }}
            onClick={() => vault.exists && select(vault)}
          >
            <CardContent>
              <Typography variant="h6">{vault.label}</Typography>
              <Typography variant="body2" color="text.secondary">
                {vault.location}
              </Typography>
              {vault.unlocked && (
                <Chip size="small" label="Unlocked" sx={{ mt: 1 }} />
              )}
              {!vault.exists && (
                <Chip size="small" label="Missing" sx={{ mt: 1 }} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 3 }}>
        <Button
          variant="outlined"
          startIcon={<OpenIcon />}
          onClick={openFromDisk}
        >
          Open…
        </Button>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDialog({ kind: 'create' })}
        >
          New…
        </Button>
      </Box>

      {dialog?.kind === 'unlock' && (
        <PasswordDialog
          title={`Unlock ${dialog.vault.label}`}
          onSubmit={unlock}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'create' && (
        <PasswordDialog
          title="New environment vault"
          withName
          onSubmit={create}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};

export default EnvVaultsPanel;
