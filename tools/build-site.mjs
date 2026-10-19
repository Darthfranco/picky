import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
rmSync(output, { recursive: true, force: true });
mkdirSync(path.join(output, 'assets/dice'), { recursive: true });

const files = ['index.html', 'manifest.json', 'PickyNB.png',
    ...readdirSync(root).filter(name => /\.(css|js)$/.test(name))];
for (const file of files) cpSync(path.join(root, file), path.join(output, file));
cpSync(path.join(root, 'images'), path.join(output, 'images'), { recursive: true });
cpSync(path.join(root, 'assets/dice/models.json'), path.join(output, 'assets/dice/models.json'));
console.log('Prepared static runtime files in dist/');
