// Works on Windows, macOS and Linux without shell-specific environment syntax.
process.env.NODE_ENV = 'production';
await import('../dist/boot.js');
