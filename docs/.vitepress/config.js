import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'SecureVault',
  description:
    'A secure, offline password & environment-variable manager — desktop app (GUI) and terminal (CLI), sharing the same encrypted vaults.',

  // Project Pages are served under /<repo>/ — https://benzid-wael.github.io/secure-vault/
  base: '/secure-vault/',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,

  // Existing internal docs live in docs/ too. The deep-dive specs under
  // docs/environments/ were authored for GitHub's Markdown renderer (bare <tag>
  // usage blocks, ASCII diagrams) and don't survive VitePress's Vue compiler, so
  // we exclude them from the build and link out to their GitHub-rendered form
  // from the Reference section instead.
  srcExclude: [
    'screenshots/README.md',
    'environments/**',
    '**/node_modules/**',
  ],

  head: [['meta', { name: 'theme-color', content: '#3c8772' }]],

  markdown: {
    // Inline code should never be treated as a Vue interpolation. VitePress
    // auto-adds `v-pre` to fenced code blocks but NOT to inline code, so a span
    // like `{{env:name/KEY}}` would otherwise be parsed as a Vue expression and
    // break the build. Emit inline code with `v-pre` so `{{ }}` renders verbatim.
    config: (md) => {
      md.renderer.rules.code_inline = (tokens, idx) =>
        `<code v-pre>${md.utils.escapeHtml(tokens[idx].content)}</code>`;
    },
  },

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Get started', link: '/guide/getting-started' },
      {
        text: 'Guide',
        items: [
          { text: 'Desktop app (GUI)', link: '/guide/gui/' },
          { text: 'Command line (CLI)', link: '/guide/cli/' },
        ],
      },
      { text: 'Reference', link: '/reference/' },
      {
        text: 'Download',
        link: 'https://github.com/benzid-wael/secure-vault/releases/latest',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Overview', link: '/guide/getting-started' },
            { text: 'Concepts & terms', link: '/guide/concepts' },
          ],
        },
        {
          text: 'Desktop app (GUI)',
          collapsed: false,
          items: [
            { text: 'Install & first vault', link: '/guide/gui/' },
            {
              text: 'Managing passwords',
              link: '/guide/gui/managing-passwords',
            },
            { text: 'Security & best practices', link: '/guide/gui/security' },
          ],
        },
        {
          text: 'Command line (CLI)',
          collapsed: false,
          items: [
            { text: 'Install & basics', link: '/guide/cli/' },
            { text: 'Password vaults', link: '/guide/cli/passwords' },
            { text: 'Environment vaults', link: '/guide/cli/env-vaults' },
            {
              text: 'Delivering secrets to files',
              link: '/guide/cli/delivering-secrets',
            },
            { text: 'The agent (v2.0 preview)', link: '/guide/cli/agent' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference & deep dives',
          items: [
            { text: 'Overview', link: '/reference/' },
            {
              text: 'Environment vault spec ↗',
              link: 'https://github.com/benzid-wael/secure-vault/blob/main/docs/environments/SPEC.md',
            },
            {
              text: 'Agent design ↗',
              link: 'https://github.com/benzid-wael/secure-vault/blob/main/docs/environments/AGENT-DESIGN.md',
            },
            {
              text: 'Mobile integration gaps ↗',
              link: 'https://github.com/benzid-wael/secure-vault/blob/main/docs/environments/MOBILE-INTEGRATION-GAPS.md',
            },
            { text: 'Code signing', link: '/CODE_SIGNING' },
            { text: 'Releasing', link: '/RELEASING' },
            { text: 'Security issues', link: '/security-issues' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/benzid-wael/secure-vault' },
    ],

    editLink: {
      pattern:
        'https://github.com/benzid-wael/secure-vault/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: { provider: 'local' },

    footer: {
      message: 'Released under the MIT License.',
      copyright:
        'Everything stays on your machine — zero-knowledge, offline by design.',
    },
  },
});
