# Reference & deep dives

The guides cover day-to-day use. These documents go deeper — the design decisions,
threat models, and internal specs behind SecureVault. They're written for
contributors and anyone who wants to understand exactly how things work.

## Environment vaults

These deep-dive specs are maintained as Markdown in the repo and rendered on GitHub:

- [**Environment vault spec ↗**](https://github.com/benzid-wael/secure-vault/blob/main/docs/environments/SPEC.md)
  — the full design of the `vault env` feature set: storage format, layering,
  references, versioning, and the roadmap for the agent and delivery.
- [**Agent design ↗**](https://github.com/benzid-wael/secure-vault/blob/main/docs/environments/AGENT-DESIGN.md)
  — the v2.0 session daemon: the security contract, the two-tier lock,
  request-scoped protocol, and a plain-language breakdown of the native
  capabilities pure Node can't provide (and why).
- [**Mobile integration gaps ↗**](https://github.com/benzid-wael/secure-vault/blob/main/docs/environments/MOBILE-INTEGRATION-GAPS.md)
  — how secrets flow into **Xcode** and **Android Studio / Gradle** builds, what
  works today, and the gap analysis + task breakdown driving the roadmap.

## Distribution & operations

- [**Code signing**](/CODE_SIGNING) — how (and whether) the app and CLI binaries are signed.
- [**Releasing**](/RELEASING) — how releases are built, versioned, and published.
- [**Security issues**](/security-issues) — how to report a vulnerability and known considerations.

## The short version of the security model

- **Zero-knowledge** — the master password is never stored; it derives the key at
  unlock and is then discarded.
- **AES-256-GCM** authenticated encryption with **PBKDF2** (100,000 iterations, SHA-512)
  and a 32-byte random per-vault salt.
- **Offline** — no server, no sync, no account, no telemetry. Everything is on your machine.
- **Injection over delivery** — prefer passing secrets into a process in memory
  (`vault env run`) over writing files; when files are unavoidable, `clean` them and
  `.gitignore` them.
