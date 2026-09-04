import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const packageMetadata = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.manifest_version !== 3 || manifest.version !== packageMetadata.version) {
  throw new Error(`Expected Manifest V3 release ${packageMetadata.version}`);
}

const files = readFileSync('scripts/release-files.txt', 'utf8').trim().split('\n');
for (const file of files) {
  if (!existsSync(file)) throw new Error(`Missing release file: ${file}`);
}

for (const file of ['js/defaults.js', 'js/options.js', 'js/popup.js']) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Validated Manifest V3 ${manifest.version}, ${files.length} release files and JavaScript syntax.`);
