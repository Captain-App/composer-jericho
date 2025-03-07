const cp = require('child_process');
const path = require('path');

// Kill any existing process on port 7777
try {
  cp.execSync('lsof -ti:7777 | xargs kill -9');
} catch (err) {
  // Ignore errors if no process was found
}

// Start the debug server first
require('./debug-server');

// Launch Cursor with our extension
const extensionPath = path.resolve(__dirname, '..');
const cursorPath = '/Applications/Cursor.app/Contents/MacOS/Cursor';

console.log('Launching Cursor with extension...');
console.log('Extension path:', extensionPath);

// Launch with VS Code extension development flags
const args = [
  '--extensionDevelopmentPath=' + extensionPath,
  '--user-data-dir=' + path.join(extensionPath, '.cursor-dev'),
  '--extensions-dir=' + path.join(extensionPath, '.cursor-dev', 'extensions'),
  '--enable-proposed-api',
  '--new-window',
  '--skip-welcome',
  '--skip-release-notes',
  '--disable-workspace-trust',
  '--disable-telemetry'
];

const cursor = cp.spawn(cursorPath, args, {
  env: {
    ...process.env,
    VSCODE_DEV: '1',
    NODE_ENV: 'development',
    VSCODE_HANDLES_UNCAUGHT_ERRORS: 'true',
    VSCODE_HANDLES_SIGPIPE: 'true'
  },
  stdio: 'inherit'
});

cursor.on('error', (err) => {
  console.error('Failed to start Cursor:', err);
  process.exit(1);
});

cursor.on('exit', (code) => {
  if (code !== 0) {
    console.error(`Cursor exited with code ${code}`);
    process.exit(code);
  }
}); 