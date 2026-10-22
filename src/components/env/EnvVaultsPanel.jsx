import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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

/**
 * Unlock or create: the password goes to main once and isn't kept here.
 * `remember` (unlock only, when this computer can keep it safely, New-24)
 * is `{ initial }`: the box starts ticked for a vault whose password is
 * already kept, and unticking it forgets that password. `onUseSaved`
 * offers the kept password again, e.g. after a canceled Touch ID.
 */
function PasswordDialog({
  title,
  withName = false,
  remember = null,
  initialError = '',
  onSubmit,
  onUseSaved = null,
  onClose,
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [keep, setKeep] = useState(remember?.initial ?? false);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  const finish = (result) => {
    setBusy(false);
    if (!result.success) setError(result.error || 'Something went wrong');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (withName && password !== confirm) {
      setError('The passwords do not match');
      return;
    }
    setBusy(true);
    finish(
      await onSubmit({ name, password, remember: remember ? keep : undefined })
    );
  };

  const useSaved = async () => {
    setBusy(true);
    setError('');
    finish(await onUseSaved());
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
          {remember && (
            <>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={keep}
                    onChange={(e) => setKeep(e.target.checked)}
                  />
                }
                label="Remember on this computer"
              />
              <Typography variant="body2" color="text.secondary">
                Kept encrypted by the system keychain. Anyone using your account
                here can then open this vault in the app, after Touch ID where
                the Mac has it.
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          {onUseSaved && (
            <Button disabled={busy} onClick={useSaved} sx={{ mr: 'auto' }}>
              Use saved password
            </Button>
          )}
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
function EnvVaultScreen({ vault, onBack, onLock, onLocked, onForget }) {
  const api = envApi();
  const [envs, setEnvs] = useState(null);
  const [revision, setRevision] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newEnv, setNewEnv] = useState('');
  const [menu, setMenu] = useState(null); // { anchor, env }
  const [manage, setManage] = useState(null); // { op, env, description, extends }
  const [notice, setNotice] = useState(vault.notice ?? '');
  // Bumped when the file changes outside the app; EnvView reloads on it.
  const [externalChange, setExternalChange] = useState(0);
  const [changingPassword, setChangingPassword] = useState(false);
  const [quietReload, setQuietReload] = useState(0);
  // Set when the vault uses features this version doesn't know (New-29):
  // the message names them and the upgrade; nothing that writes is offered.
  const [readOnly, setReadOnly] = useState('');

  const load = useCallback(async () => {
    const result = await api.listEnvs(vault.id);
    if (!result.success) {
      if (result.code === 'LOCKED') onLocked();
      else setError(result.error);
      return;
    }
    setEnvs(result.envs);
    setRevision(result.revision);
    setReadOnly(result.readOnly ? result.formatMessage : '');
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
        {vault.remembered && (
          <Button onClick={onForget}>Forget saved password</Button>
        )}
        {!readOnly && (
          <Button variant="outlined" onClick={() => setChangingPassword(true)}>
            Change password
          </Button>
        )}
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
      {readOnly && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>Read-only.</strong> {readOnly}
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
                  !readOnly && (
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
                  )
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
          {!readOnly && (
            <Box sx={{ p: 1 }}>
              <Button
                fullWidth
                startIcon={<AddIcon />}
                onClick={() => setCreating(true)}
              >
                New environment
              </Button>
            </Box>
          )}
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
              readOnly={Boolean(readOnly)}
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
  // Whether this computer can keep a password safely (New-24).
  const [keychain, setKeychain] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { kind: 'unlock', vault, error? } | { kind: 'create' }
  const [openVault, setOpenVault] = useState(null);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const result = await api.list();
    if (result.success) {
      setVaults(result.vaults);
      setKeychain(Boolean(result.keychain));
    } else setError(result.error);
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

  // `notice` shows on the vault screen once it opens.
  const enter = async (id, notice = '') => {
    const listed = await refresh();
    const vault = listed.find((v) => v.id === id);
    setOpenVault(vault ? { ...vault, notice } : null);
    setDialog(null);
    setNotice('');
  };

  // A kept password is tried first; if it fails, the dialog says why.
  const unlockSaved = async (vault) => {
    const result = await api.unlockSaved(vault.id);
    if (result.success) await enter(vault.id);
    return result;
  };

  const select = async (vault) => {
    if (vault.unlocked) return enter(vault.id);
    if (vault.remembered) {
      const result = await unlockSaved(vault);
      if (result.success) return;
      const listed = await refresh();
      const current = listed.find((v) => v.id === vault.id) ?? vault;
      return setDialog({
        kind: 'unlock',
        vault: current,
        error: result.code === 'CANCELED' ? '' : result.error,
      });
    }
    setDialog({ kind: 'unlock', vault });
  };

  const openFromDisk = async () => {
    const result = await api.open();
    if (result.canceled) return;
    if (!result.success) return setError(result.error);
    const listed = await refresh();
    const vault = listed.find((v) => v.id === result.id);
    if (vault) select(vault);
  };

  const unlock = async ({ password, remember }) => {
    const result = await (remember === undefined
      ? api.unlock(dialog.vault.id, password)
      : api.unlock(dialog.vault.id, password, { remember }));
    if (result.success) {
      await enter(
        dialog.vault.id,
        remember && result.remembered === false
          ? "Unlocked, but the password couldn't be saved on this computer (the keychain refused it)."
          : ''
      );
    }
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
        onForget={async () => {
          await api.forgetPassword(openVault.id);
          const listed = await refresh();
          setOpenVault(listed.find((v) => v.id === openVault.id) ?? null);
        }}
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
                <Chip size="small" label="Unlocked" sx={{ mt: 1, mr: 1 }} />
              )}
              {vault.remembered && (
                <Chip size="small" label="Password saved" sx={{ mt: 1 }} />
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
          remember={keychain ? { initial: dialog.vault.remembered } : null}
          initialError={dialog.error}
          onUseSaved={
            dialog.vault.remembered ? () => unlockSaved(dialog.vault) : null
          }
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
