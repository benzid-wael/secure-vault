import { spawn } from 'child_process';

/**
 * Resolve the user's editor command honoring the conventional precedence:
 * $VISUAL → $EDITOR → vi. The value may contain arguments ("code --wait"),
 * so it is split on whitespace into command + args.
 */
export function resolveEditor(env = process.env) {
  const editor = env.VISUAL || env.EDITOR || 'vi';
  const [cmd, ...args] = editor.split(/\s+/).filter(Boolean);
  return { cmd, args };
}

/**
 * Build the temp-file content shown in the editor when setting a value
 * interactively. The previous value (if any) appears as "#" comments so the
 * user can reference it; the new value is typed on the blank line below.
 */
export function buildEditorTemplate(key, envName, previousValue) {
  const lines = [
    `# Set value for ${key} (environment "${envName}").`,
    '# Lines starting with "#" are ignored. Save an empty file to abort.',
    '#',
  ];

  if (previousValue === undefined) {
    lines.push('# No previous value.');
  } else {
    lines.push('# Previous value:');
    for (const line of String(previousValue).split('\n')) {
      lines.push(`# ${line}`);
    }
  }

  lines.push('', '');
  return lines.join('\n');
}

/**
 * Extract the value from the edited file: drop comment lines and the
 * leading/trailing blank lines, keep interior newlines (multi-line values).
 * Returns null when nothing was entered (caller aborts without changes).
 */
export function parseEditorContent(content) {
  const lines = content.split(/\r?\n/).filter((line) => !line.startsWith('#'));

  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Open `filePath` in the user's editor and resolve once it exits cleanly.
 * Rejects when the editor cannot be launched or exits non-zero, so the
 * caller can abort instead of saving a half-edited value.
 */
export function openInEditor(filePath, env = process.env) {
  const { cmd, args } = resolveEditor(env);

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, [...args, filePath], { stdio: 'inherit' });
    proc.on('error', (err) =>
      reject(new Error(`Cannot launch editor "${cmd}": ${err.message}`))
    );
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Editor exited with status ${code}; aborting.`));
      }
    });
  });
}
