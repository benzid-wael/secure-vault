import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Typography,
} from '@mui/material';

const IDLE_CHOICES = [1, 5, 10, 15, 30, 60, 120, 240];

const minutes = (n) => (n === 1 ? '1 minute' : `${n} minutes`);

/** The preload's settings API; read at call time so tests can swap it. */
const settingsApi = () => /** @type {any} */ (window).electronAPI?.appSettings;

/**
 * App-wide settings (GUI-ENV-BREAKDOWN Tasks 13, 23): the idle timeout of
 * every vault (D1) and, with env vaults on, whether opened env vaults are
 * remembered (D5). Each change is saved, and takes effect, at once.
 *
 * @param {{envVaults?: boolean}} props
 */
const AppSettingsSection = ({ envVaults = false }) => {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await settingsApi().get();
        if (!active) return;
        if (!result.success) return setError(result.error);
        setSettings(result.settings);
        setWarning(result.warning || '');
      } catch {
        if (active) setError("The settings couldn't be loaded.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const change = async (patch, message) => {
    setError('');
    setSaved('');
    let result;
    try {
      result = await settingsApi().update(patch);
    } catch {
      result = { success: false, error: "The settings couldn't be saved." };
    }
    if (!result.success) return setError(result.error);
    setSettings(result.settings);
    setWarning('');
    setSaved(message);
  };

  if (!settings) {
    return error ? <Alert severity="error">{error}</Alert> : null;
  }

  const choices = IDLE_CHOICES.includes(settings.idleMinutes)
    ? IDLE_CHOICES
    : [...IDLE_CHOICES, settings.idleMinutes].sort((a, b) => a - b);

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2, color: '#2196f3' }}>
        App settings
      </Typography>
      {warning && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {warning}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {saved && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved('')}>
          {saved}
        </Alert>
      )}
      <FormControl size="small" sx={{ minWidth: 260, mb: 1 }}>
        <InputLabel id="idle-minutes-label">Lock vaults after</InputLabel>
        <Select
          labelId="idle-minutes-label"
          id="idle-minutes"
          label="Lock vaults after"
          value={settings.idleMinutes}
          onChange={(event) =>
            change(
              { idleMinutes: Number(event.target.value) },
              `Unlocked vaults now lock after ${minutes(
                Number(event.target.value)
              )} without activity.`
            )
          }
        >
          {choices.map((n) => (
            <MenuItem key={n} value={n}>
              {minutes(n)} without activity
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography
        variant="body2"
        sx={{ color: 'rgba(255,255,255,0.6)', mb: 2 }}
      >
        Typing, clicking and scrolling in the app count as activity.
        {envVaults &&
          ' An environment vault stays unlocked only while you work on its own screen.'}
      </Typography>
      {envVaults && (
        <Box>
          <FormControlLabel
            control={
              <Switch
                checked={settings.rememberRecents}
                onChange={(event) =>
                  change(
                    { rememberRecents: event.target.checked },
                    event.target.checked
                      ? 'Environment vaults you open will be listed after a restart.'
                      : 'The list of opened environment vaults was cleared, and new ones won’t be remembered.'
                  )
                }
              />
            }
            label="Remember environment vaults I open"
          />
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.6)' }}>
            Vaults opened from a file or folder are listed again after a
            restart. Turning this off clears that list; the vault files stay
            where they are.
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default AppSettingsSection;
