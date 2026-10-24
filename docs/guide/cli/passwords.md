# Password vaults

The `vault` CLI shares its encrypted vaults with the [desktop app](/guide/gui/),
so logins you manage in one are available in the other with the same master
password.

## Inspect & recover

```bash
vault info                       # show version and vault location
vault recover --name <vault>     # recover a vault (password, or recovery key if it uses a key file)
```

For a vault that needs a key file (set in the desktop app), `vault recover`
asks for its **recovery key** instead, then a new password, and writes
`<vault>-recovered.vault`: a copy that opens with the new password alone, with
a new recovery key it prints. The vault itself is left as it is.

`vault info` prints the version and the on-disk location of your vaults — handy
for confirming the CLI and the GUI point at the same place.

## Prefer a window?

For day-to-day login management (adding entries, searching, copying to clipboard),
the [**desktop app**](/guide/gui/) is usually the nicer experience — and it reads
the very same vaults.

The CLI's real strength is **environment vaults**: managing `.env` secrets as
encrypted, versioned data you can inject straight into commands and CI. That's the
next section.

👉 [**Environment vaults →**](/guide/cli/env-vaults)
