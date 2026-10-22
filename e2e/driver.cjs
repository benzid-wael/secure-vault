// Runs inside Electron as the main script: loads the built app's main process,
// waits for its window, and gives a scenario helpers to drive the real
// renderer. Native file dialogs are stubbed (a script can't click them);
// everything else is the production main + renderer.
const path = require('path');
const fs = require('fs');
const {
  app,
  dialog,
  BrowserWindow,
  ipcMain,
  session,
  clipboard,
} = require('electron');

const REPO = process.env.E2E_REPO;
const OUT = process.env.E2E_OUT;
const VAULTS_DIR = process.env.E2E_VAULTS_DIR;
const EXPORT_PATH = path.join(OUT, 'export.vault.json');

dialog.showSaveDialog = async () => ({
  canceled: false,
  filePath: EXPORT_PATH,
});
dialog.showOpenDialog = async () => ({
  canceled: false,
  filePaths: [EXPORT_PATH],
});
dialog.showErrorBox = (title, message) =>
  console.log('ERRORBOX', title, message);

const PAGE_HELPERS = require('./pageHelpers.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn(t)` against the app and exit with its result: 0 when every check
 * passed, 1 when one failed, 2 when the scenario threw.
 */
module.exports = function scenario(fn) {
  // A test-only preload in the same renderer reports whether it runs
  // sandboxed: that proves Electron honored `sandbox: true`, which reading
  // the window's options wouldn't (GUI-ENV-BREAKDOWN Task 1).
  const sandboxed = new Promise((resolve) =>
    ipcMain.once('e2e-sandboxed', (event, value) => resolve(value))
  );
  // Registered before main's own whenReady handler creates the window.
  app.whenReady().then(() =>
    session.defaultSession.registerPreloadScript({
      type: 'frame',
      filePath: path.join(__dirname, 'probe-preload.cjs'),
    })
  );
  // CSP violations the page reports (GUI-ENV-BREAKDOWN Task 2).
  const cspViolations = [];
  app.on('web-contents-created', (event, contents) =>
    contents.on('console-message', (details) => {
      const message = details?.message ?? String(details);
      if (/Content Security Policy/i.test(message)) cspViolations.push(message);
    })
  );

  require(path.join(REPO, 'build/electron/main.cjs'));

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(Boolean(ok));
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`
    );
  };

  (async () => {
    await app.whenReady();
    let win;
    for (let i = 0; i < 100 && !win; i += 1) {
      win = BrowserWindow.getAllWindows()[0];
      if (!win) await sleep(100);
    }
    if (!win) throw new Error('the app opened no window');
    const wc = win.webContents;
    if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));

    const js = (code) => wc.executeJavaScript(code);
    const installHelpers = () => js(PAGE_HELPERS);
    await installHelpers();

    const t = {
      check,
      sleep,
      js,
      win,
      OUT,
      VAULTS_DIR,
      EXPORT_PATH,
      ENVS_DIR: path.join(path.dirname(VAULTS_DIR), 'envs'),
      sandboxed: () =>
        Promise.race([sandboxed, sleep(5000).then(() => 'no report')]),
      cspViolations,
      clipboardText: () => clipboard.readText(),
      api: (call) => js(`window.electronAPI.${call}`),
      clickLabel: (label) =>
        js(`(() => {
          const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
          if (!el) return false;
          el.click();
          return true;
        })()`),
      hasText: (text) => js(`__e2e.hasText(${JSON.stringify(text)})`),
      waitText: async (text, ms = 10000) => {
        for (let i = 0; i < ms / 100; i += 1) {
          if (await js(`__e2e.hasText(${JSON.stringify(text)})`)) return true;
          await sleep(100);
        }
        return false;
      },
      click: (text) => js(`__e2e.clickText(${JSON.stringify(text)})`),
      fill: (label, value) =>
        js(`__e2e.fill(${JSON.stringify(label)}, ${JSON.stringify(value)})`),
      submit: () => js('__e2e.submit()'),
      reload: async () => {
        wc.reload();
        await new Promise((r) => wc.once('did-finish-load', r));
        await installHelpers();
      },
      vaultFiles: () =>
        fs.existsSync(VAULTS_DIR) ? fs.readdirSync(VAULTS_DIR) : [],
      readVault: (name) =>
        JSON.parse(
          fs.readFileSync(path.join(VAULTS_DIR, `${name}.vault`), 'utf8')
        ),
      /** The app's own VaultService, for setup a scenario does mid-run. */
      vaultService: async () => {
        const { VaultService } = await import(
          path.join(REPO, 'src/electron/services/VaultService.js')
        );
        return new VaultService(VAULTS_DIR);
      },
    };

    // Scenarios may copy to the real clipboard: give the user theirs back.
    const savedClipboard = clipboard.readText();
    try {
      await fn(t);
    } finally {
      clipboard.writeText(savedClipboard);
    }

    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    app.exit(failed ? 1 : 0);
  })().catch((error) => {
    console.log('SCENARIO ERROR', error.stack);
    app.exit(2);
  });
};
