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
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  FolderOpen as OpenIcon,
  Lock as LockIcon,
  ArrowBack as BackIcon,
  MoreVert as MoreIcon,
} from '@mui/icons-material';
import EnvView from './EnvView';
import EnvManageDialog from './EnvManageDialog';
import { envApi } from './envApi';

/** Change an env vault's password (Task 28); main checks the current one. */
function ChangePasswordDialog({ change, onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (next !== confirm) return setError('The new passwords do not match');
    setBusy(true);
    const result = await change(current, next);
    setBusy(false);
    if (!result.success) setError(result.error || 'Something went wrong');
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={submit}>
        <DialogTitle>Change password</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <TextField
            id="env-pw-current"
            label="Current password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            fullWidth
            margin="dense"
            autoFocus
          />
          <TextField
            id="env-pw-new"
            label="New password"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            fullWidth
            margin="dense"
          />
          <TextField
            id="env-pw-confirm"
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            fullWidth
            margin="dense"
            helperText="Every tool and script that opens this vault needs the new password."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={busy || !current || !next || !confirm}
          >
            Change
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

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
  const [menu, setMenu] = useState(null); // { anchor, env }
  const [manage, setManage] = useState(null); // { op, env, description, extends }
  const [notice, setNotice] = useState('');
  // Bumped when the file changes outside the app; EnvView reloads on it.
  const [externalChange, setExternalChange] = useState(0);
  const [changingPassword, setChangingPassword] = useState(false);
  const [quietReload, setQuietReload] = useState(0);

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

  // The CLI or a sync tool changed the file (Task 16).
  useEffect(
    () =>
      api.onChanged?.(({ id, missing }) => {
        if (id !== vault.id) return;
        if (missing) {
          setError('The vault file was moved or deleted outside the app.');
          return;
        }
        load();
        setExternalChange((n) => n + 1);
      }),
    [api, vault.id, load]
  );

  const runManage = async (fields) => {
    const result = await api.manageEnv(vault.id, {
      ...fields,
      expectedRevision: revision,
    });
    if (!result.success) {
      if (result.code === 'LOCKED') onLocked();
      if (result.code === 'STALE') {
        load();
        return {
          ...result,
          error:
            'This vault was changed elsewhere; the list is reloaded, try again',
        };
      }
      return result;
    }
    setManage(null);
    setQuietReload((n) => n + 1); // the file changed under the env on screen
    const { op, env, name } = fields;
    if (op === 'rename' && selected === env) setSelected(name);
    if (op === 'duplicate') setSelected(name);
    if (op === 'delete' && selected === env) setSelected(null);
    setNotice(
      {
        rename: `Renamed ${env} to ${name}.`,
        duplicate: `Copied ${env} to ${name}.`,
        delete: `Deleted ${env}. A copy of the vault was kept.`,
        extends: `Updated the parent of ${env}.`,
        describe: `Updated the description of ${env}.`,
      }[op]
    );
    const listed = await api.listEnvs(vault.id);
    if (listed.success) {
      setEnvs(listed.envs);
      setRevision(listed.revision);
      if (op === 'delete' && selected === env) {
        setSelected(listed.envs[0]?.name ?? null);
      }
    }
    return result;
  };

  const openManage = (op) => {
    const env = envs.find((e) => e.name === menu.env);
    setMenu(null);
    setManage({
      op,
      env: env.name,
      description: env.description,
      extends: env.extends,
    });
  };

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
        <Button variant="outlined" onClick={() => setChangingPassword(true)}>
          Change password
        </Button>
        <Button startIcon={<LockIcon />} variant="outlined" onClick={onLock}>
          Lock
        </Button>
      </Box>
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
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <Paper sx={{ width: 240, flexShrink: 0 }}>
          <List dense aria-label="Environments">
            {(envs || []).map((env) => (
              <ListItem
                key={env.name}
                disablePadding
                secondaryAction={
                  <IconButton
                    edge="end"
                    size="small"
                    aria-label={`Manage ${env.name}`}
                    onClick={(e) =>
                      setMenu({ anchor: e.currentTarget, env: env.name })
                    }
                  >
                    <MoreIcon fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemButton
                  selected={env.name === selected}
                  onClick={() => setSelected(env.name)}
                >
                  <ListItemText
                    primary={env.name}
                    secondary={[
                      `${env.varCount} variables`,
                      env.extends && `extends ${env.extends}`,
                      env.description,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    secondaryTypographyProps={{
                      sx: { wordBreak: 'break-word' },
                    }}
                  />
                </ListItemButton>
              </ListItem>
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
              externalChange={externalChange}
              quietReload={quietReload}
            />
          )}
        </Box>
      </Box>

      {changingPassword && (
        <ChangePasswordDialog
          change={async (current, next) => {
            const result = await api.changePassword(vault.id, current, next);
            if (result.code === 'LOCKED') onLocked();
            if (!result.success) return result;
            setChangingPassword(false);
            setQuietReload((n) => n + 1);
            load();
            setNotice(
              result.skippedSnapshots.length
                ? `Password changed. ${result.skippedSnapshots.length} older snapshot(s) didn't open with the old password and were left as they are.`
                : 'Password changed. Snapshots were re-encrypted with it.'
            );
            return result;
          }}
          onClose={() => setChangingPassword(false)}
        />
      )}

      <Menu
        anchorEl={menu?.anchor ?? null}
        open={menu !== null}
        onClose={() => setMenu(null)}
      >
        <MenuItem onClick={() => openManage('rename')}>Rename…</MenuItem>
        <MenuItem onClick={() => openManage('duplicate')}>Duplicate…</MenuItem>
        <MenuItem onClick={() => openManage('describe')}>Description…</MenuItem>
        <MenuItem onClick={() => openManage('extends')}>
          Parent environment…
        </MenuItem>
        <MenuItem
          onClick={() => openManage('delete')}
          sx={{ color: 'error.main' }}
        >
          Delete…
        </MenuItem>
      </Menu>

      {manage && (
        <EnvManageDialog
          request={manage}
          envNames={(envs || []).map((e) => e.name)}
          onSubmit={runManage}
          onClose={() => setManage(null)}
        />
      )}

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
