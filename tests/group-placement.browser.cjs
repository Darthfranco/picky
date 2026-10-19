#!/usr/bin/env node
// Finger 5+ uses the screen as a shared touch surface, keeping each numbered
// bubble exactly where its owner first touched instead of arranging a roster.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) {
    ({ chromium } = require(path.join(process.env.HOME,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')));
}

const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, pathname.slice(1) || 'index.html');
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, body) => {
        res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(error ? 'Not found' : body);
    });
});

async function touch(session, type, points = []) {
    await session.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([x, y], id) => ({ id, x, y, radiusX: 12, radiusY: 12, force: 1 }))
    });
}

async function assertPositions(page, expected, reason) {
    const actual = await page.locator('.group-entry').evaluateAll(entries => entries.map(entry => {
        const box = entry.getBoundingClientRect();
        return { number: Number(entry.dataset.number), x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }));
    assert.equal(actual.length, expected.length, `${reason}: one bubble per contact`);
    for (let index = 0; index < expected.length; index++) {
        assert.equal(actual[index].number, index + 1, `${reason}: numbers stay in join order`);
        assert.ok(Math.abs(actual[index].x - expected[index][0]) <= 2 && Math.abs(actual[index].y - expected[index][1]) <= 2,
            `${reason}: player ${index + 1} should stay at (${expected[index].join(', ')}), found (${actual[index].x}, ${actual[index].y})`);
    }
}

async function run(browser, address, viewport, theme) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    try {
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(theme => localStorage.setItem('picky.preferences.v1', JSON.stringify({ theme, pinned: ['finger', 'wheel'] })), theme);
        await page.goto(address, { waitUntil: 'load' });
        await page.locator('.mode-switcher').click();
        await page.locator('.more-tab').click();
        await page.locator('.mode-row[data-mode="group"]').click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);

        const point = (x, y) => [Math.round(viewport.width * x), Math.round(viewport.height * y)];
        const first = point(.37, .32);
        const expected = [first];
        await touch(session, 'touchStart', [first]);
        await page.waitForTimeout(280); // Allow the entry animation to settle while the finger is still down.
        await assertPositions(page, expected, 'Pointerdown shows the number beneath the finger');
        await touch(session, 'touchMove', [[first[0] + 22, first[1] + 24]]);
        await touch(session, 'touchEnd');
        await assertPositions(page, expected, 'Moving and lifting preserves the original position without another entry');

        const simultaneous = [point(.71, .5), point(.22, .63)];
        expected.push(...simultaneous);
        await touch(session, 'touchStart', simultaneous);
        await page.waitForTimeout(280);
        await assertPositions(page, expected, 'Simultaneous fingers each claim their own position');
        await touch(session, 'touchEnd');
        await assertPositions(page, expected, 'Lifting simultaneous fingers keeps all positions');

        // Edge contacts remain centered on the actual touch, even if part of
        // the bubble is clipped by the screen. Existing players must not move.
        const edge = [2, Math.round(viewport.height * .46)];
        expected.push(edge);
        await touch(session, 'touchStart', [edge]);
        await page.waitForTimeout(280);
        await touch(session, 'touchEnd');
        await assertPositions(page, expected, 'A new edge contact does not reflow or clamp the roster');
        assert.equal(await page.locator('#group-entries').evaluate(entries => entries.scrollTop), 0, 'The touch surface never scrolls to a new player');

        await page.locator('#up-arrow').click({ clickCount: 2 });
        assert.equal((await page.locator('#winner-count').textContent()).trim(), '3');
        await assertPositions(page, expected, 'Changing the winner count does not add or move players');
        await page.locator('#group-undo').click();
        expected.pop();
        await assertPositions(page, expected, 'Undo removes only the latest player');

        // A later player may choose an occupied point; numbered entries must
        // retain their exact coordinates instead of being spaced automatically.
        expected.push(first);
        await touch(session, 'touchStart', [first]);
        await page.waitForTimeout(280);
        await touch(session, 'touchEnd');
        await assertPositions(page, expected, 'Tapping an existing bubble joins at that exact position');

        const pickBounds = await page.locator('#group-pick').boundingBox();
        const pickPoint = [pickBounds.x + pickBounds.width / 2, pickBounds.y + pickBounds.height / 2];
        await touch(session, 'touchStart', [pickPoint]);
        await page.waitForTimeout(200);
        await touch(session, 'touchEnd');
        await page.waitForTimeout(1300);
        assert.equal(await page.locator('#game-container').evaluate(game => game.classList.contains('charging')), true, 'A short Pick tap starts the longer countdown after release');
        assert.equal(await page.locator('.group-entry.chosen').count(), 0, 'The old short countdown cannot choose early');
        await touch(session, 'touchStart', [point(.87, .54)]);
        await touch(session, 'touchEnd');
        await page.waitForFunction(() => document.querySelectorAll('.group-entry.chosen').length === 3, null, { timeout: 4500 });
        const winners = await page.locator('.group-entry.chosen').evaluateAll(entries => entries.map(entry => Number(entry.dataset.number)));
        assert.equal(winners.length, 3);
        assert.equal(new Set(winners).size, 3);
        assert.ok(winners.every(number => number >= 1 && number <= expected.length));
        assert.equal(await page.locator('#play-again').count(), 0, 'There is no replay button');
        assert.equal(await page.locator('#result-screen').isHidden(), true, 'Group winners stay on their bubbles rather than a full-screen number');
        assert.ok(await page.locator('#game-container').evaluate(game => game.style.background), 'The selected colors fill the result background');
        await assertPositions(page, expected, 'Winner bubbles keep the exact original touch positions');
        const review = process.env.PICKY_REVIEW_DIR || path.join(root, '.impeccable/review');
        fs.mkdirSync(review, { recursive: true });
        await page.screenshot({ path: path.join(review, `group-${viewport.width}-${theme}-result.png`), animations: 'disabled' });
        await page.waitForTimeout(700);
        assert.equal(await page.locator('.group-entry.chosen').count(), 3, 'Results remain briefly readable without holding a finger');
        await page.waitForFunction(() => !document.querySelector('.group-entry.chosen'), null, { timeout: 2500 });
        assert.equal((await page.locator('#winner-count').textContent()).trim(), '3', 'Automatic result clearing preserves the winner count');
        await assertPositions(page, expected, 'Automatic result clearing preserves every numbered position');

        if (viewport.width === 414 && theme === 'dark') {
            await page.locator('#group-pick').focus();
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => document.querySelectorAll('.group-entry.chosen').length === 3, null, { timeout: 4500 });
            await page.waitForFunction(() => !document.querySelector('.group-entry.chosen'), null, { timeout: 3500 });
            await page.waitForTimeout(2700);
            assert.equal(await page.locator('.group-entry.chosen').count(), 0, 'Keyboard activation starts exactly one selection');
            await assertPositions(page, expected, 'Keyboard Pick preserves every numbered position');

            await page.locator('#group-pick').tap();
            const focusPreserved = await page.evaluate(() => {
                const focused = document.activeElement;
                window.dispatchEvent(new Event('blur'));
                return document.activeElement === focused;
            });
            await page.waitForTimeout(2700);
            assert.equal(await page.locator('.group-entry.chosen').count(), 0, 'Blurring during Pick cancels its pending result');
            assert.equal(await page.locator('#game-container').evaluate(game => game.style.background), '', 'Blur clears the result background');
            assert.equal((await page.locator('#winner-count').textContent()).trim(), '3', 'Blur preserves the winner setting');
            assert.equal(focusPreserved, true, 'Canceling on blur does not steal keyboard focus');
            await assertPositions(page, expected, 'Blur preserves every claimed player');
        }

        await page.locator('#group-clear').click();
        await assertPositions(page, [], 'Clear removes the whole roster');
        assert.equal(await page.locator('#group-pick').isDisabled(), true);
        if (viewport.width === 414 && theme === 'dark') {
            for (const position of simultaneous) {
                await touch(session, 'touchStart', [position]);
                await touch(session, 'touchEnd');
            }
            await page.locator('#group-pick').tap();
            await page.evaluate(() => {
                Object.defineProperty(document, 'hidden', { configurable: true, value: true });
                document.dispatchEvent(new Event('visibilitychange'));
                delete document.hidden;
            });
            await page.waitForTimeout(2700);
            assert.equal(await page.locator('.group-entry').count(), 0, 'Reopening clears a pending Pick roster');
            assert.equal(await page.locator('#game-container').evaluate(game => game.classList.contains('has-result')), false, 'A canceled Pick cannot show a stale result');
            assert.equal((await page.locator('#winner-count').textContent()).trim(), '1');
        }
        assert.deepEqual(errors, [], 'No browser JavaScript errors');
        console.log(`PASS Finger 5+ touch placement, multitouch, edge/overlap, undo, repick, and clear (${viewport.width}×${viewport.height}, ${theme})`);
    } finally {
        await context.close();
    }
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
        const address = `http://127.0.0.1:${server.address().port}/`;
        for (const viewport of [{ width: 414, height: 896 }, { width: 320, height: 640 }, { width: 844, height: 390 }]) {
            for (const theme of ['dark', 'light']) {
                if (process.env.PICKY_TEST_VARIANT && process.env.PICKY_TEST_VARIANT !== `${viewport.width}-${theme}`) continue;
                await run(browser, address, viewport, theme);
            }
        }
        console.log('All Finger 5+ placement regressions passed.');
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
