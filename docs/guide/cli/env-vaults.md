# Environment vaults

Manage per-project `.env` secrets as encrypted, versioned vaults — then inject
them into any command without ever writing plaintext to disk.

## The mental model

- Variable-level commands (`set`, `get`, `rm`) take the **key** as the argument and
  the environment as `-e <env>`.
- Environment-level commands (`show`, `delete`, `rename`, `copy`, …) take the
  **environment name** as the argument.
- There is **no implicit default environment**. Every command must be told which
  environment to act on. Resolution order:
  **explicit argument / `-e` → `VAULT_ENV` → error.**

## Everyday commands

```bash
vault env init                   # create an environment vault for this project
vault env import dev .env        # import a .env file into the "dev" environment
vault env set API_KEY s3cr3t -e dev   # set a variable in "dev"
vault env set API_KEY -e dev          # no value: edit in $EDITOR (old value shown, commented)
vault env get API_KEY -e dev          # read it back
vault env show dev               # show all variables in an environment
vault env list                   # list environments in the vault
vault env export dev             # print as dotenv (or JSON with --format json)
vault env template dev           # generate a .env.template (keys only)
vault env diff dev prod          # compare two environments
vault env history dev            # view version history
vault env rollback 3 -e dev      # restore a previous version of "dev"
```

::: tip Safety built in
Every write keeps a `<vault>.bak` of the previous good state and saves atomically,
so an interrupted save can never corrupt the vault. Deleting an environment leaves
a timestamped `<vault>.deleted.<ts>` copy.
:::

## Running commands with secrets {#running-commands-with-secrets}

`vault env run` decrypts the environment, injects it into a child process, and
cleans up afterwards — **secrets never touch disk unless you ask.** It has two
independent controls:

- **`--inject clean|merge`** — _how the child's environment is built._
  `clean` (default) passes only your vault vars plus a small allowlist
  (`PATH`, `HOME`, `SHELL`, `USER`, `TMPDIR`). `merge` keeps your whole shell env
  and layers vault vars on top.
- **`--export <path>`** — _also write a temporary `.env` to disk_ for tools that
  insist on reading one. It composes with either inject mode.

```bash
vault env run dev -- npm start                 # inject and run
vault env run dev --export .env -- npm start   # also write a temp .env (wiped on exit)
vault env run dev --dry-run                    # preview what would be injected (no spawn)
vault env shell dev                            # interactive shell with the env loaded
```

### Recipes

| I want to…                                                | Command                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| Run with only my vault vars (+ PATH/HOME/…), nothing else | `vault env run dev -- npm start`                                |
| Keep my whole shell env and add vault vars on top         | `vault env run dev --inject merge -- npm start`                 |
| Give a build tool a real `.env` (auto-wiped after)        | `vault env run dev --export .env -- npx react-native run-ios`   |
| Add my own one-off variable                               | `vault env run dev --set FEATURE_FLAG=on -- npm test`           |
| Load extra vars from a file                               | `vault env run dev --env-file .env.local -- npm test`           |
| Let specific shell vars through in clean mode             | `vault env run dev --allowlist NODE_PATH,LANG -- npm run build` |
| Preview what would be injected (no spawn)                 | `vault env run dev --dry-run`                                   |
| Drop into an interactive shell with the env loaded        | `vault env shell dev`                                           |

### About `--export`

The file is created `0600`, the child receives `ENV_FILE_PATH=<path>` so tools can
locate it, and it is securely deleted when the command exits — on success **or**
failure. To avoid clobbering a file you care about, `--export` refuses to overwrite
an existing path unless you pass `--force`.

**Your own variables vs. shell passthrough.** `--set KEY=VALUE` (repeatable) and
`--env-file <path>` add _explicit_ variables: they are injected **and** written into
the `--export` file, layered under your vault vars (the vault wins on a conflict, and
`--set` beats `--env-file`). By contrast, `--inject merge` and `--allowlist` only let
your _existing_ shell variables through to the process — they never get written to the
exported file. So the on-disk `.env` always contains exactly "vault vars + your
explicit additions".

::: warning Disk wiping is best-effort
The 3-pass overwrite can't guarantee erasure on SSDs and copy-on-write filesystems
(APFS, btrfs), and a hard kill (`kill -9`) or power loss before exit can leave the
file behind. Treat `--export` as "auto-cleanup on normal exit", not a guarantee
against forensic recovery.
:::

::: info Deprecation
The older `--inject file --out-file <path>` is now an alias for `--export <path>` and
prints a warning; it is removed in v2.0. Replace `--inject file --out-file X` with
`--export X`.
:::

## Zero-friction project setup {#project-setup}

Drop a `.vaultrc` at your project root to avoid repeating flags on every invocation:

```json
{
  "inject": "merge",
  "name": "my-project",
  "allowlistFile": ".vault-allowlist"
}
```

Set `VAULT_ENV`, `VAULT_NAME`, or `VAULT_INJECT` for CI pipelines — they fill in the
same defaults. Precedence: **CLI flags → `.vaultrc` → environment variables.**

```bash
export VAULT_ENV=staging
vault env run -- node server.js          # env name from VAULT_ENV
VAULT_INJECT=merge vault env run -- ...   # inject mode from env var
```

Pass a per-project allowlist file to let extra system vars through in `clean` mode
(one var per line, `#` comments supported):

```bash
# .vault-allowlist
NODE_PATH
LANG   # locale settings
TERM   # terminal type
```

`.vault-allowlist` is loaded automatically if present; override with
`--allowlist-file <path>`.

## Layering & template references {#layering-template-references}

Environments can **extend** a parent so shared variables live in one place, and values
can **reference** another variable with `{{env:<name>/<KEY>}}` (use `self` for the same
environment). Both are resolved on read — by `export`, `run`, `get`, `diff`, and
`validate` — so the stored value keeps its reference and re-resolves whenever the source
changes.

```bash
# Shared defaults in a "base" environment
vault env set LOG_LEVEL info -e base --public
vault env set PORT 3000 -e base --public --required

# "staging" inherits base, then overrides. Any `set` creates the environment;
# `extends` wires the parent (which must already exist; --none clears it).
vault env set API_URL https://staging.example.com -e staging --public
vault env extends staging base
vault env set PORT 8080 -e staging --public           # override an inherited value

# Reference another environment, or your own keys with self.
# --extends sets the parent in the same step as the write.
vault env set --extends base DB_URL '{{env:staging/API_URL}}' -e dev
vault env set ENDPOINT 'localhost:{{env:self/PORT}}' -e dev   # PORT inherited from base

vault env export staging --format json   # base keys merged in (PORT shows 8080)
vault env validate dev                   # required keys aggregated across the chain
```

Layering and references support chains up to **5 deep**; circular `extends`, circular
references, and missing keys are reported as validation errors.

Wire layering up front at import time (import every environment in the chain):

```bash
vault env init --env base:.env.base --env staging:.env.staging --extends staging:base
```

Other commands: `rm`, `delete`, `rename`, `copy`, `squash`, `extends`,
`change-password`. Run `vault env <command> --help` for the full options of any command.

## Next

- Native mobile builds need real files on disk — [**Delivering secrets to files →**](/guide/cli/delivering-secrets)
- Keep a vault unlocked across a session — [**The agent →**](/guide/cli/agent)
