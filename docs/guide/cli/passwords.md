# Password vaults

The `vault` CLI shares its encrypted vaults with the [desktop app](/guide/gui/),
so logins you manage in one are available in the other with the same master
password.

## Inspect & recover

```bash
vault info                       # show version and vault location
vault recover --name <vault>     # recover a vault with your master password
```

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
