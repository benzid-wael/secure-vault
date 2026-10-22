import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

const MASK = '••••••••';

/**
 * Compare two envs as they resolve (GUI-ENV-BREAKDOWN Task 26). Masked by
 * default: "Show values" asks main again with `reveal: true`.
 * `load(other, reveal)` resolves to the `env:diff` result.
 */
export function EnvCompareDialog({ env, otherEnvs, load, onClose }) {
  const [other, setOther] = useState(otherEnvs[0] ?? '');
  const [reveal, setReveal] = useState(false);
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!other) return undefined;
    let active = true;
    load(other, reveal).then((result) => {
      if (!active) return;
      if (result.success) {
        setDiff(result);
        setError('');
      } else setError(result.error || 'Could not compare');
    });
    return () => {
      active = false;
    };
  }, [load, other, reveal]);

  const rows = diff
    ? [
        ...diff.changed.map((c) => ({ ...c, status: 'different' })),
        ...diff.added.map((key) => ({ key, status: `only in ${other}` })),
        ...diff.removed.map((key) => ({ key, status: `only in ${env}` })),
      ]
    : [];

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Compare {env}</DialogTitle>
      <DialogContent>
        {otherEnvs.length === 0 ? (
          <Typography>There is no other environment in this vault.</Typography>
        ) : (
          <TextField
            id="env-compare-other"
            select
            label="With"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            margin="dense"
            sx={{ minWidth: 220, mr: 2 }}
          >
            {otherEnvs.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>
        )}
        {otherEnvs.length > 0 && (
          <FormControlLabel
            sx={{ mt: 2 }}
            control={
              <Switch
                checked={reveal}
                onChange={(e) => setReveal(e.target.checked)}
              />
            }
            label="Show values"
          />
        )}
        {error && (
          <Alert severity="error" sx={{ my: 2 }}>
            {error}
          </Alert>
        )}
        {diff && rows.length === 0 && (
          <Typography sx={{ mt: 2 }}>
            Same variables and values ({diff.unchanged}).
          </Typography>
        )}
        {diff && rows.length > 0 && (
          <Table size="small" aria-label="Differences" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>Key</TableCell>
                <TableCell />
                <TableCell>{env}</TableCell>
                <TableCell>{other}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    {r.key}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={r.status} />
                  </TableCell>
                  <TableCell
                    sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                  >
                    {r.status === 'different' ? (r.valueA ?? MASK) : ''}
                  </TableCell>
                  <TableCell
                    sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                  >
                    {r.status === 'different' ? (r.valueB ?? MASK) : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {diff && rows.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {diff.unchanged} more {diff.unchanged === 1 ? 'is' : 'are'} the
            same.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

/** `vault env validate` for one env (Task 26). */
export function EnvValidateDialog({ env, load, onClose }) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;
    load().then((r) => active && setResult(r));
    return () => {
      active = false;
    };
  }, [load]);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Validate {env}</DialogTitle>
      <DialogContent>
        {result && !result.success && (
          <Alert severity="error">{result.error}</Alert>
        )}
        {result?.success &&
          result.errors.length === 0 &&
          result.warnings.length === 0 && (
            <Alert severity="success">
              No problems found ({result.varCount} variables,{' '}
              {result.requiredCount} required).
            </Alert>
          )}
        {result?.success &&
          result.errors.map((message) => (
            <Alert key={message} severity="error" sx={{ mb: 1 }}>
              {message}
            </Alert>
          ))}
        {result?.success &&
          result.warnings.map((message) => (
            <Alert key={message} severity="warning" sx={{ mb: 1 }}>
              {message}
            </Alert>
          ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
