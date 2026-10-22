import { useState } from 'react';
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
  Radio,
  RadioGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

const STATUS_COLOR = { new: 'success', changed: 'warning', same: 'default' };

/**
 * Preview and apply a .env import into one env (GUI-ENV-BREAKDOWN Task 27).
 * `preview` comes from `env:import-pick`: key names with their status
 * (new, changed, same), the env's own keys the file lacks, and the
 * parser's warnings. No value is shown: they stay in main.
 */
export default function EnvImportDialog({ env, preview, apply, onClose }) {
  const [chosen, setChosen] = useState(
    preview.keys.filter((k) => k.status !== 'same').map((k) => k.key)
  );
  const [mode, setMode] = useState('merge');
  const hasComments = preview.keys.some((k) => k.comment);
  const [useComments, setUseComments] = useState(hasComments);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (key) =>
    setChosen((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key]
    );

  const removing = mode === 'replace' ? preview.absent : [];
  const nothing = chosen.length === 0 && removing.length === 0;

  const submit = async () => {
    setBusy(true);
    const result = await apply({ mode, comments: useComments, keys: chosen });
    setBusy(false);
    if (!result.success) setError(result.error || 'Something went wrong');
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        Import {preview.fileName} into {env}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {preview.warnings.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            These lines are skipped:
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {preview.warnings.map((w) => (
                <li key={`${w.line}:${w.message}`}>
                  Line {w.line}: {w.message}
                </li>
              ))}
            </Box>
          </Alert>
        )}
        {preview.keys.length === 0 ? (
          <Typography>No variables found in this file.</Typography>
        ) : (
          <Table size="small" aria-label="Keys to import">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Key</TableCell>
                <TableCell>In {env}</TableCell>
                <TableCell>Comment in the file</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {preview.keys.map((k) => (
                <TableRow key={k.key}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={chosen.includes(k.key)}
                      onChange={() => toggle(k.key)}
                      inputProps={{ 'aria-label': `Import ${k.key}` }}
                    />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    {k.key}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={k.status}
                      color={STATUS_COLOR[k.status]}
                    />
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {k.comment}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <RadioGroup
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          sx={{ mt: 2 }}
        >
          <FormControlLabel
            value="merge"
            control={<Radio size="small" />}
            label={`Add and update the chosen keys; keep the rest of ${env}`}
          />
          <FormControlLabel
            value="replace"
            control={<Radio size="small" />}
            label={`Replace: also remove ${env}'s keys the file doesn't have (${preview.absent.length})`}
          />
        </RadioGroup>
        {removing.length > 0 && (
          <Typography variant="body2" color="warning.main">
            Removes: {removing.join(', ')}
          </Typography>
        )}
        {hasComments && (
          <FormControlLabel
            control={
              <Checkbox
                checked={useComments}
                onChange={(e) => setUseComments(e.target.checked)}
              />
            }
            label="Use the file's # comments as key comments"
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || nothing} onClick={submit}>
          Import
        </Button>
      </DialogActions>
    </Dialog>
  );
}
