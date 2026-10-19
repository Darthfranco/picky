#!/usr/bin/env node
// Export the existing SVG brandmark on its opaque black square. This script
// needs sharp, either installed locally or in the Codex desktop runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); }
catch (_) {
    sharp = require(path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'));
}

const root = fileURLToPath(new URL('../', import.meta.url));
const imagePath = name => path.join(root, 'images', name);
const source = await readFile(imagePath('favicon.svg'));
const embedded = source.toString().match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)?.[1];
assert.ok(embedded, 'The SVG must retain its embedded brandmark.');
assert.equal(createHash('sha256').update(Buffer.from(embedded, 'base64')).digest('hex'),
    'fe9736f670dbff305759910aff88c3ff27fef7afcdaace8c81d577a61a5b735e',
    'The original embedded brandmark bytes must not change.');
assert.ok(source.includes('<rect width="1000" height="1000" fill="#000000">'), 'Keep the full black background.');
assert.ok(!source.includes('clip-path='), 'The black background must not have clipped corners.');

async function render(size) {
    return sharp(source).resize(size, size).ensureAlpha().png().toBuffer();
}

async function validate(buffer, size, label) {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, size, `${label}: width`);
    assert.equal(info.height, size, `${label}: height`);
    let nonBlackRadius = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const offset = (y * size + x) * 4;
            const [r, g, b, alpha] = data.subarray(offset, offset + 4);
            assert.equal(alpha, 255, `${label}: opaque pixel at ${x}, ${y}`);
            if (!x || !y || x === size - 1 || y === size - 1) {
                assert.deepEqual([r, g, b], [0, 0, 0], `${label}: black edge at ${x}, ${y}`);
            }
            if (Math.max(r, g, b) > 0) nonBlackRadius = Math.max(nonBlackRadius, Math.hypot(x + .5 - size / 2, y + .5 - size / 2));
        }
    }
    // App icons fit the exact safe circle. Tiny browser favicons may spread a
    // fractional edge into one output pixel when reduced to 16–48 pixels.
    assert.ok(nonBlackRadius <= size * .4 + (size < 180 ? 1 : 0), `${label}: brandmark must fit the maskable safe circle`);
    return `${label}: ${size}×${size}, alpha 255, every edge pixel #000000, artwork radius ${(nonBlackRadius / size).toFixed(4)}`;
}

const original = await sharp(Buffer.from(embedded, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let y = 0; y < original.info.height; y++) {
    for (let x = 0; x < original.info.width; x++) {
        const offset = (y * original.info.width + x) * 4;
        if (original.data[offset + 3] && Math.max(...original.data.subarray(offset, offset + 3))) {
            assert.ok(Math.hypot(x + .5 - original.info.width / 2, y + .5 - original.info.height / 2) <= original.info.width * .4,
                'Original brandmark must fit within the maskable 80% diameter safe circle.');
        }
    }
}

const outputs = new Map([
    [96, ['favicon-96x96.png']],
    [180, ['apple-touch-icon.png', 'apple-touch-icon-black.png']],
    [192, ['web-app-manifest-192x192.png', 'web-app-manifest-black-192x192.png', 'icon-192.png']],
    [512, ['web-app-manifest-512x512.png', 'web-app-manifest-black-512x512.png', 'icon-512.png']]
]);
for (const [size, names] of outputs) {
    const buffer = await render(size);
    for (const name of names) {
        console.log(await validate(buffer, size, name));
        await writeFile(imagePath(name), buffer);
    }
}

// PNG-backed ICO entries keep the same opaque artwork at common tab sizes.
const iconSizes = [16, 32, 48];
const icons = await Promise.all(iconSizes.map(render));
const directory = Buffer.alloc(6 + icons.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(icons.length, 4);
let offset = directory.length;
for (let index = 0; index < icons.length; index++) {
    await validate(icons[index], iconSizes[index], `favicon.ico/${iconSizes[index]}`);
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = iconSizes[index];
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(icons[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += icons[index].length;
}
await writeFile(imagePath('favicon.ico'), Buffer.concat([directory, ...icons]));
console.log('favicon.ico: opaque black 16×16, 32×32 and 48×48 entries.');
