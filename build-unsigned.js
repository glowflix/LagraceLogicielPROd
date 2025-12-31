#!/usr/bin/env node

// Hook pour electron-builder - désactiver la signature
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  const module = originalRequire.apply(this, arguments);
  
  // Patch la fonction de signing
  if (id === 'app-builder-lib' && module.WinPackager) {
    const original = module.WinPackager.prototype.signApp;
    module.WinPackager.prototype.signApp = async function() {
      console.log('[SKIP] Skipping Windows code signing');
      return;
    };
  }
  
  return module;
};

// Relancer electron-builder
require('electron-builder').build({
  win: [{ target: 'nsis', arch: 'x64' }],
  publish: null
}).catch(e => {
  console.error(e);
  process.exit(1);
});
