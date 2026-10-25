import { defineConfig } from 'vitepress';

const sponsor = 'https://github.com/sponsors/benzid-wael';

// Simple Icons "githubsponsors" heart, used for the Sponsor social link.
const heartIcon =
  '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Sponsor</title><path d="M17.625 1.499c-2.32 0-4.354 1.203-5.625 3.03-1.271-1.827-3.305-3.03-5.625-3.03C3.129 1.499 0 4.253 0 8.249c0 4.275 3.068 7.847 5.828 10.227a33.14 33.14 0 0 0 5.616 3.876l.028.017.008.003-.001.003c.163.085.342.126.521.125.179.001.358-.041.521-.125l-.001-.003.008-.003.028-.017a33.14 33.14 0 0 0 5.616-3.876C20.932 16.096 24 12.524 24 8.249c0-3.996-3.129-6.75-6.375-6.75zm-.919 15.275a30.766 30.766 0 0 1-4.703 3.316l-.004-.002-.004.002a30.955 30.955 0 0 1-4.703-3.316c-2.677-2.307-5.047-5.298-5.047-8.523 0-2.754 2.121-4.5 4.125-4.5 2.06 0 3.914 1.479 4.544 3.684.143.495.596.797 1.086.796.49.001.943-.302 1.085-.796.63-2.205 2.484-3.684 4.544-3.684 2.004 0 4.125 1.746 4.125 4.5 0 3.225-2.37 6.216-5.048 8.523z"/></svg>';

// installation.md and releasing.md predate the site and live at the docs root;
// they share the Reference sidebar so readers can navigate from them.
const referenceSidebar = [
  {
    text: 'Reference',
    items: [
      { text: 'CLI', link: '/reference/cli' },
      { text: 'Engines', link: '/reference/engines' },
      { text: 'Detection rules', link: '/reference/rules' },
      { text: 'Detection benchmark', link: '/reference/benchmark' },
      { text: 'Installation details', link: '/installation' },
      { text: 'Releasing', link: '/releasing' },
    ],
  },
];

// https://vitepress.dev/reference/site-config

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
    'RFCs/**',
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
      { text: '❤ Sponsor', link: '/support' },
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
            { text: 'Environment vaults', link: '/guide/gui/env-vaults' },
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
            { text: 'Support the project ❤', link: '/support' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/benzid-wael/secure-vault' },
      {
        icon: { svg: heartIcon },
        link: sponsor,
        ariaLabel: 'Sponsor on GitHub',
      },
    ],

    editLink: {
      pattern:
        'https://github.com/benzid-wael/secure-vault/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: { provider: 'local' },

    footer: {
      message:
        'Released under the MIT License. <a href="https://github.com/sponsors/benzid-wael">Sponsor the project ❤</a>',
      copyright:
        'Everything stays on your machine — zero-knowledge, offline by design.',
    },
  },
});
