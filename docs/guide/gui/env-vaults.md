# Environment vaults in the app

The desktop app can open the same encrypted environment vaults the
[`vault env` CLI](/guide/cli/env-vaults) uses: browse and edit variables,
manage environments, look back through history, import and export `.env`
files. The CLI stays the main tool. Anything you change in one shows up in
the other.

::: warning Preview
The Environments screens are still being finished, so release builds hide
them. To try them, start the app with `SECURE_VAULT_ENV_UI=1` set in its
environment. On macOS, from a terminal:

```bash
SECURE_VAULT_ENV_UI=1 "/Applications/Secure Password Manager.app/Contents/MacOS/Secure Password Manager"
```

:::

## Open the Environments screen

On the vault selector, switch **Vault type** from **Passwords** to
**Environments**. The list shows:

- vaults in the app's own folder, by name. They're kept in
  `<app data>/envs/<name>.env.vault`. The app data folder is
  `~/Library/Application Support/secure-password-manager` on macOS,
  `%APPDATA%\secure-password-manager` on Windows and
  `~/.secure-password-manager` on Linux;
- vaults you opened from a project, most recent first, shown as
  `folder/file`.

A card marked **Missing** points to a file that's no longer there.
**Remove from list** on a locked, opened vault takes it off the list and
forgets its saved password. The file isn't touched.

### Add a vault to the list

- **Open folder…**: pick a project folder, and the app opens the vault the
  CLI would use there. It looks for `.env.vault` in the folder and its
  parents up to the git root, then `config/.env.vault`, then a vault named
  after the folder in the app folder.
- **Open…**: pick a vault file directly. The dialog lists `.vault` files
  first; if yours is named differently, or greyed out, choose **All
  files** in the dialog. Any file that is an environment vault opens. The
  extensions listed first are a setting.
- **New…**: create a vault in the app folder. Give it a name (letters,
  digits, `-`, `_`) and a password of at least 8 characters with upper and
  lower case letters, a digit and a symbol. To create a vault inside a
  project, use `vault env init` in a terminal.

### Unlock and lock

Click a vault and type its password. Tick **Remember on this computer** to
keep the password, encrypted by the system keychain. Next time, clicking
the vault unlocks it straight away, after Touch ID on a Mac that has it.
Anyone using your account on this computer can then open the vault in the
app, so leave it off on a shared account.

If the vault's password was changed elsewhere, the saved one stops working:
the app forgets it and asks you to type the new one. **Forget saved
password** in the vault's header drops it on purpose.

**Lock** locks the vault. **Vaults** goes back to the list and leaves it
unlocked. A vault also locks by itself:

- after a while without activity on its own screen (5 minutes unless you
  change it in [Settings](#settings));
- when the computer sleeps or the screen locks.

## Work with variables

The left column lists the vault's environments with their variable count,
parent and description. Pick one to see its variables.

- **Secret or public.** Secret values show as `••••••••`. Click the eye to
  reveal one; it hides again when you switch environment or lock. Public
  values are always shown.
- **Inherited keys** come from the parent environment. They're dimmed and
  tagged `from <parent>`. Editing one (**Override**) gives this environment
  its own value; the parent keeps its value.
- **Comments** show under the key. They're never masked, so don't put
  secrets in them.
- **Long values** are cut short; **Show** opens the full value.

### Copy

The copy button copies the value. The **⋮** menu on a row also has **Copy
key name** and **Copy KEY=value**. A copied secret is cleared from the
clipboard after 30 seconds, unless you've copied something else since.

### Add, edit, delete

- **Add variable**: a key (letters, digits, `_`, not starting with a digit),
  a value, **Secret (masked)** (ticked by default) and an optional comment.
- The pencil edits a variable; the bin deletes it.

Every save adds a new version of the environment, so nothing is lost: see
[History](#history).

### Edit many at once

**Edit as .env** opens the environment's own variables as `.env` text, one
`KEY=value` per line, with `#` lines right above a key as its comment. Add,
change or remove lines, then **Save**. New keys are secret. Lines the app
can't read are listed, and Save stays off until they're fixed.

### Copy or move keys to another environment

Use **Copy to environment…** or **Move to environment…** in a row's **⋮**
menu. To act on several keys, tick their rows and use **Copy to…** or
**Move to…**. Values, the secret flag and comments go along. If the target
already has a key, the app asks before overwriting it. Inherited keys can
be copied but not moved.

## Manage environments

**New environment** is at the bottom of the list. Each environment's **⋮**
menu has:

- **Rename…**: environments that extend it follow the new name. If others
  use it in references like `{{env:staging/API_URL}}`, the app offers to
  update them too, ticked by default.
- **Duplicate…**: copies the current variables, flags and comments. The
  copy's history starts fresh.
- **Description…**
- **Parent environment…**: its variables show in this one unless this one
  sets them. See [layering](/guide/cli/env-vaults#layering-template-references).
- **Delete…**: removes the environment and all its versions. A copy of the
  vault is kept next to it first (`<vault>.deleted.<time>`). An environment
  that others extend can't be deleted until they extend something else.

## History

**History** lists every version of the environment, newest first, with its
message and which keys it added or removed. Values aren't shown.

- **Roll back** makes an old version current again, saved as a new version.
- **Squash…** merges old versions away, keeping the number you choose. A
  copy of the vault is kept next to it first (`<vault>.squashed.<time>`).

## Compare and validate

In the **⋮** menu next to **Export .env**:

- **Compare with…** shows what differs between two environments, after
  parents and references are resolved. Values stay masked unless you turn
  on **Show values**.
- **Validate** checks that required keys are present and set and that
  references resolve. It warns about key names that aren't UPPER_CASE and
  about values that look like a private key or live token.

## Import and export

- **Import .env…** previews the file first: each key is **new**,
  **changed** or **same**, and you pick which to import. **Merge** keeps
  the environment's other keys; **Replace** also removes the ones the file
  doesn't have, and lists them. The file's `#` comments can become key
  comments. Values are never shown in the preview.
- **Export .env** saves the environment, with parents and references
  resolved, as a `.env` file only you can read. For JSON, use
  `vault env export <env> --format json`.
- **Save template (.env.example)…** saves every key without its value,
  with required keys marked `<required>`.

## When the CLI changes the vault

The app notices when the vault file changes while it's open, from the CLI,
a script or a sync tool.

- If you're just looking, the environment reloads and says so.
- If you're in the middle of something, a banner says the vault changed
  elsewhere, with **Reload**. You can keep going: saving merges your edit
  with the other change. If you both changed the same key, the app names it
  and lets you reload or overwrite with yours.
- Revealing or copying a key that changed since you saw it asks you to
  reload first.

## Change the password

**Change password** in the vault's header. Every script and tool that
opens the vault needs the new password afterwards. Snapshots made by delete
and squash are re-encrypted with it, and a saved password follows the
change.

## Settings {#settings}

Open **Configuration** (Ctrl/Cmd+S). Under **App settings**:

- **Lock vaults after**: from 1 minute to 4 hours without activity. An
  environment vault counts only typing, clicking and scrolling on its own
  screen.
- **Remember environment vaults I open**: lists opened vaults again after a
  restart. Turning it off clears that list; the files stay where they are.
- **Environment vault file extensions**: what **Open…** lists first,
  separated by commas (`.vault` by default).
- **Forget all saved passwords**: drops every password kept on this
  computer. The vaults don't change; you type each password next time.

## A vault from a newer SecureVault

If a vault uses features this version doesn't know, the app opens it
**read-only**: you can read, copy, export, compare and look at history, but
not change it, since saving would drop data. Upgrade the app and the CLI to
edit it.

## What only the CLI does

- Mark a key as required: `vault env set KEY value --required -e <env>`.
- Run a command with an environment injected: `vault env run`.
- Create a vault inside a project: `vault env init`.
- Export as JSON: `vault env export <env> --format json`.

## Next

- [**Environment vaults in the CLI**](/guide/cli/env-vaults)
- [**Security & best practices**](/guide/gui/security)
