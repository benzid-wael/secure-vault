# Managing passwords

Once your vault is unlocked, everyday password management happens from the main
window.

## Add a password

1. Click the **+** floating action button.
2. Fill in the entry:
   - **Title** _(required)_
   - **Username / Email** _(required)_
   - **Password** _(required)_ — click the **generate** button for a strong random one
   - **URL** _(optional)_
   - **Notes** _(optional)_
3. Click **Add**.

::: tip Use the generator
The built-in password generator produces strong, random passwords so you never
have to reuse one. Generate a fresh password per site.
:::

## Find, view, and copy

- **Search** — use the search bar to filter entries as you type.
- **Reveal** — click the eye icon to show or hide a password.
- **Copy** — click the copy icon next to any field (username, password, URL) to
  put it on your clipboard.

## Edit or delete

- **Edit** — open the entry's menu (**⋮**) and choose **Edit**.
- **Delete** — open the menu (**⋮**) and choose **Delete**.

## It's the same data as the CLI

Every entry you add here lives in the same encrypted vault the [`vault` CLI](/guide/cli/)
reads. Add a login in the app, and it's available in the terminal with the same
master password — and vice-versa.

## Next

- [**Security & best practices**](/guide/gui/security)
