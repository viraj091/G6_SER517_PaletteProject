const { spawn } = require('child_process');
const path = require('path');

module.exports = {
  handleSquirrelEvent: function(app) {
    if (process.argv.length === 1) {
      return false;
    }

    const appFolder = path.resolve(process.execPath, '..');
    const rootAtomFolder = path.resolve(appFolder, '..');
    const updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
    const exeName = path.basename(process.execPath);

    const spawnUpdate = function(args) {
      let spawnedProcess;
      try {
        spawnedProcess = spawn(updateDotExe, args, { detached: true });
      } catch (error) {
        // Handle error if Update.exe is not available
        return;
      }
      return spawnedProcess;
    };

    const squirrelEvent = process.argv[1];
    switch (squirrelEvent) {
      case '--squirrel-install':
      case '--squirrel-updated':
        // Install desktop and start menu shortcuts
        spawnUpdate(['--createShortcut', exeName]);
        setTimeout(app.quit, 1000);
        return true;

      case '--squirrel-uninstall':
        // Remove desktop and start menu shortcuts
        spawnUpdate(['--removeShortcut', exeName]);
        setTimeout(app.quit, 1000);
        return true;

      case '--squirrel-obsolete':
        // This is called on the outgoing version of your app before
        // we update to the new version - it's the opposite of
        // --squirrel-updated
        app.quit();
        return true;
    }

    return false;
  }
};
