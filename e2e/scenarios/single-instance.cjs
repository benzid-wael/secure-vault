// A second launch shows the running app's window and quits, instead of
// starting another process with its own vault sessions (Task 11).
const path = require('path');
const { spawn } = require('child_process');
const { app, BrowserWindow } = require('electron');
const scenario = require('../driver.cjs');

scenario(async (t) => {
  t.check('the app opens', await t.waitText('Create your first vault'));
  t.win.minimize();
  const handedOver = new Promise((resolve) =>
    app.once('second-instance', () => resolve(true))
  );

  const second = spawn(
    process.execPath,
    [path.join(__dirname, '..', 'second-instance.cjs')],
    { env: process.env, stdio: 'ignore' }
  );
  const exited = new Promise((resolve) => second.on('exit', resolve));
  const code = await Promise.race([
    exited,
    t.sleep(20000).then(() => 'still running'),
  ]);
  if (code === 'still running') second.kill();

  t.check('the second launch quits', code === 0, String(code));
  t.check(
    'the running app is told',
    await Promise.race([handedOver, t.sleep(2000).then(() => false)])
  );
  await t.sleep(500);
  t.check('it shows its window again', !t.win.isMinimized());
  t.check('still one window', BrowserWindow.getAllWindows().length === 1);
});
