import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { VpnKey as KeyIcon } from '@mui/icons-material';

/** The preload's key file API (New-54); read at call time for tests. */
const keyFileApi = () => /** @type {any} */ (window).electronAPI?.keyFile;

const DIALOGS = {
  enable: {
    title: 'Require a key file',
    action: 'Require Key File',
    choose: true,
    note: 'Keep the key file away from the vault (a USB stick, another drive) and keep a copy. Without it, only the recovery key opens the vault. Older versions of SecureVault can’t open the vault while a key file is required.',
  },
  change: {
    title: 'Change the key file',
    action: 'Change Key File',
    choose: true,
    note: 'You’ll choose the current key file first; it stops working once the new one is in place.',
  },
  disable: {
    title: 'Stop requiring a key file',
    action: 'Stop Requiring It',
    choose: false,
    note: 'You’ll choose the key file to confirm. The password alone opens the vault again, and a new recovery key is made: save it.',
  },
};

/**
 * The vault's key file (PASSWORD-VAULT-2FA-RFC.md, New-54 step 3): require
 * one, change it, or stop requiring it. Main creates and picks key files in
 * native dialogs; this sends only the password.
 *
 * @param {{vaultName: string,
 *   onRecoveryKey: (key: string) => void,
 *   onMessage: (message: string, severity?: string) => void}} props
 */
const KeyFileSection = ({ vaultName, onRecoveryKey, onMessage }) => {
  const [enabled, setEnabled] = useState(null);
  const [mode, setMode] = useState(null); // 'enable' | 'change' | 'disable'
  const [password, setPassword] = useState('');
  const [create, setCreate] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await keyFileApi()?.status(vaultName);
      if (result?.success) setEnabled(result.enabled);
    } catch {
      // Not offered: the section stays hidden.
    }
  }, [vaultName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (enabled === null) return null;

  const open = (next) => {
    setMode(next);
    setPassword('');
    setCreate(true);
    setError('');
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    let result;
    try {
      const api = keyFileApi();
      result =
        mode === 'disable'
          ? await api.disable(vaultName, password)
          : await api[mode](vaultName, password, { create });
    } catch {
      result = { success: false, error: 'Something went wrong. Try again.' };
    }
    setBusy(false);
    if (result.canceled) return;
    if (!result.success) return setError(result.error);
    setMode(null);
    await refresh();
    const done = {
      enable: `${vaultName} now needs its key file (${result.keyFile}) as well as its password.`,
      change: `${vaultName} now uses ${result.keyFile}; the old key file no longer opens it.`,
      disable: `${vaultName} no longer needs a key file.`,
    }[mode];
    onMessage(
      result.warning ? `${done} ${result.warning}` : done,
      result.warning ? 'warning' : 'success'
    );
    if (result.recoveryKey) onRecoveryKey(result.recoveryKey);
  };

  const dialog = mode && DIALOGS[mode];

  return (
    <Card sx={{ mb: 3, backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <KeyIcon sx={{ mr: 2, color: '#2196f3' }} />
          <Typography variant="h6" sx={{ color: 'white' }}>
            Key file
          </Typography>
        </Box>
        <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 2 }}>
          {enabled
            ? 'This vault needs its key file as well as its master password to unlock.'
            : 'Require a key file as well as the master password: a copy of the vault and its password then open nothing without it.'}
        </Typography>
        {enabled ? (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" onClick={() => open('change')}>
              Change Key File…
            </Button>
            <Button
              variant="outlined"
              color="warning"
              onClick={() => open('disable')}
            >
              Stop Requiring a Key File…
            </Button>
          </Box>
        ) : (
          <Button variant="contained" onClick={() => open('enable')}>
            Require a Key File…
          </Button>
        )}
      </CardContent>

      <Dialog open={Boolean(dialog)} onClose={() => !busy && setMode(null)}>
        {dialog && (
          <>
            <DialogTitle>{dialog.title}</DialogTitle>
            <DialogContent>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {dialog.note}
              </Typography>
              <TextField
                fullWidth
                autoFocus
                type="password"
                label="Master Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                sx={{ mb: 1 }}
              />
              {dialog.choose && (
                <RadioGroup
                  value={create ? 'create' : 'existing'}
                  onChange={(e) => setCreate(e.target.value === 'create')}
                >
                  <FormControlLabel
                    value="create"
                    control={<Radio />}
                    label="Create a new key file"
                  />
                  <FormControlLabel
                    value="existing"
                    control={<Radio />}
                    label="Use a key file I already have"
                  />
                </RadioGroup>
              )}
              {error && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {error}
                </Alert>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setMode(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={submit}
                disabled={busy || !password}
              >
                {dialog.action}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Card>
  );
};

export default KeyFileSection;
