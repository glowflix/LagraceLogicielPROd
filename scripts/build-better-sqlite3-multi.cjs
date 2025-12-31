// Script pour compiler better-sqlite3 pour deux versions de Node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BSJ_DIR = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');
const BUILD_DIR = path.join(BSJ_DIR, 'build');

function copyFile(src, dest) {
    console.log(`  Copying: ${path.basename(src)} → ${path.basename(dest)}`);
    fs.copyFileSync(src, dest);
}

function compile(nodeVersion) {
    const NODE_MODULE = nodeVersion === '24' ? 137 : 119;
    console.log(`\n📦 Compiling for Node.js v${nodeVersion} (MODULE_VERSION ${NODE_MODULE})`);
    
    try {
        // Clean
        if (fs.existsSync(BUILD_DIR)) {
            console.log(`  Cleaning build directory...`);
            execSync(`cd "${BSJ_DIR}" && npx node-gyp clean`, { stdio: 'inherit' });
        }
        
        // Configure
        console.log(`  Configuring...`);
        execSync(`cd "${BSJ_DIR}" && $env:GYP_MSVS_VERSION=2022; npx node-gyp configure --msvs_version=2022`, 
            { shell: 'powershell', stdio: 'inherit' });
        
        // Fix ClangCL
        console.log(`  Fixing ClangCL...`);
        execSync(`PowerShell -ExecutionPolicy Bypass -Command ". '${__dirname}\\fix-clangcl.ps1'"`, 
            { stdio: 'inherit' });
        
        // Build
        console.log(`  Building...`);
        execSync(`cd "${BSJ_DIR}" && $env:GYP_MSVS_VERSION=2022; npx node-gyp build --release`, 
            { shell: 'powershell', stdio: 'inherit' });
        
        // Copy to bindings location
        const src = path.join(BUILD_DIR, 'Release', 'better_sqlite3.node');
        const dest = path.join(BSJ_DIR, 'lib', 'binding', `node-v${NODE_MODULE}-win32-x64`, 'better_sqlite3.node');
        
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        copyFile(src, dest);
        
        console.log(`✓ Built for NODE_MODULE_VERSION ${NODE_MODULE}`);
        return true;
    } catch (e) {
        console.error(`✗ Failed: ${e.message}`);
        return false;
    }
}

console.log('=== Better-SQLite3 Multi-Version Compiler ===\n');

// First compile for npm Node v24 (MODULE 137)
const built24 = compile('24');

// Then compile for Electron Node v20 (MODULE 119)
// Note: Requires npm install node@20 or electron-builder to provide it
const built20 = compile('20');

if (built24 && built20) {
    console.log('\n✓ All versions compiled successfully!');
} else {
    console.log('\n✗ Some compilations failed');
    process.exit(1);
}
