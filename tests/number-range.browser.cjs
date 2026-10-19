#!/usr/bin/env node
// Exercise the shared range arrows with real touch events, including interrupted holds.
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
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
    const file = path.resolve(root, relative || 'index.html');
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, body) => {
        res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(error ? 'Not found' : body);
    });
});

async function touch(session, type, x = 207, y = 440) {
    await session.send('Input.dispatchTouchEvent', {
        type, touchPoints: ['touchEnd', 'touchCancel'].includes(type) ? [] : [{ id: 0, x, y, radiusX: 10, radiusY: 10, force: 1 }]
    });
}

async function mode(page, id) {
    await page.locator('.mode-switcher').click();
    await page.locator('.more-tab').click();
    await page.locator(`.mode-row[data-mode="${id}"]`).click();
}

async function value(page) { return Number(await page.locator('#winner-count').textContent()); }

async function holdArrow(page, session, id) {
    const box = await page.locator(`#${id}`).boundingBox();
    await touch(session, 'touchStart', box.x + box.width / 2, box.y + box.height / 2);
}

async function roll(page, session, randomValue, expected) {
    await page.evaluate(seed => {
        let first = true;
        crypto.getRandomValues = array => { array.fill(first ? seed : 0); first = false; return array; };
    }, randomValue);
    await touch(session, 'touchStart');
    assert.equal(await page.locator('#winner-selector-container').isHidden(), true);
    await page.locator('#result-screen').waitFor({ state: 'visible', timeout: 6000 });
    assert.equal(Number(await page.locator('#result-value').textContent()), expected);
    assert.equal((await page.locator('#result-screen').textContent()).trim(), String(expected), 'The result contains only the outcome');
    assert.equal(await page.locator('#play-again').count(), 0, 'There is no Again button');
}

async function releaseResult(page, session) {
    await touch(session, 'touchEnd');
    assert.equal(await page.locator('#result-screen').isHidden(), true, 'Release clears the outcome immediately');
    assert.equal((await page.locator('#number-value').textContent()).trim(), '0', 'The next number round starts at zero');
}

async function run(browser, address) {
    const context = await browser.newContext({ viewport: { width: 414, height: 896 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(address);
    await page.evaluate(() => document.addEventListener('pointerdown', event => {
        if (event.target.closest('#up-arrow, #down-arrow')) window.lastArrowPointerId = event.pointerId;
    }));
    await mode(page, 'number');
    assert.equal(await value(page), 100);
    assert.equal(await page.locator('#winner-label').textContent(), 'Max');
    await page.locator('#up-arrow').tap();
    assert.equal(await value(page), 101, 'A touch tap adds exactly one');
    await page.locator('#down-arrow').tap();
    assert.equal(await value(page), 100);
    await page.locator('#up-arrow').focus();
    await page.keyboard.press('Enter');
    assert.equal(await value(page), 101, 'Keyboard activation remains a single step');
    await page.locator('#down-arrow').click();

    await holdArrow(page, session, 'up-arrow');
    await page.waitForTimeout(240);
    assert.equal(await value(page), 100, 'A held press waits for the long-press threshold');
    await page.waitForTimeout(450);
    await touch(session, 'touchEnd');
    const held = await value(page);
    assert.ok(held >= 120 && (held - 100) % 10 === 0, `Hold jumps in tens without a release step (${held})`);
    await page.waitForTimeout(350);
    assert.equal(await value(page), held, 'Release stops repeat');
    await page.locator('#up-arrow').tap();
    assert.equal(await value(page), held + 1, 'The next ordinary tap is not swallowed');

    await holdArrow(page, session, 'down-arrow');
    await page.waitForTimeout(560);
    await touch(session, 'touchCancel');
    const cancelled = await value(page);
    assert.ok(cancelled < held + 1 && (held + 1 - cancelled) % 10 === 0);
    await page.waitForTimeout(400);
    assert.equal(await value(page), cancelled, 'Pointer cancellation stops repeat');

    await holdArrow(page, session, 'up-arrow');
    await page.waitForTimeout(460);
    await page.evaluate(() => document.getElementById('up-arrow').releasePointerCapture(window.lastArrowPointerId));
    // Browsers process a pending capture change before the next pointer event.
    await touch(session, 'touchMove', 207, 150);
    await page.waitForTimeout(50);
    const lostCapture = await value(page);
    await page.waitForTimeout(450);
    await touch(session, 'touchEnd');
    assert.equal(await value(page), lostCapture, 'Lost capture stops repeat and suppresses the trailing click');
    console.log('PASS range arrows: single taps, keyboard, repeated tens, release, cancellation, and lost capture');

    await holdArrow(page, session, 'up-arrow');
    await page.waitForTimeout(450);
    await page.evaluate(() => {
        document.querySelector('.mode-switcher').click();
        document.querySelector('.more-tab').click();
        document.querySelector('.mode-row[data-mode="finger"]').click();
    });
    await touch(session, 'touchEnd');
    await page.waitForTimeout(450);
    assert.equal(await value(page), 1, 'Changing modes cancels the old hold without altering the next mode');
    await mode(page, 'number');
    assert.equal(await value(page), 100);
    await holdArrow(page, session, 'up-arrow');
    await page.waitForTimeout(450);
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.hidden;
    });
    await touch(session, 'touchEnd');
    await page.waitForTimeout(450);
    assert.equal(await value(page), 100, 'Backgrounding resets the range and cancels the old hold');
    console.log('PASS mode changes and backgrounding reset the range to 100 and stop arrow timers');

    await page.locator('#up-arrow').click({ clickCount: 3 });
    assert.equal(await value(page), 103);
    await touch(session, 'touchStart');
    await page.waitForTimeout(200);
    await touch(session, 'touchEnd');
    assert.equal(await value(page), 103, 'Early game release preserves the chosen maximum');
    for (const target of [1, 103]) {
        await roll(page, session, target - 1, target);
        await releaseResult(page, session);
        assert.equal(await value(page), 103, 'Release preserves the range');
    }
    await holdArrow(page, session, 'down-arrow');
    await page.waitForFunction(() => document.getElementById('winner-count').textContent === '1');
    await touch(session, 'touchEnd');
    assert.equal(await page.locator('#down-arrow').isDisabled(), true);
    await roll(page, session, 0, 1);
    await releaseResult(page, session);
    assert.equal(await value(page), 1, 'A single-outcome range is supported');
    await page.reload();
    await mode(page, 'number');
    assert.equal(await value(page), 100, 'A fresh app starts with the default maximum');
    console.log('PASS custom range endpoints, single-outcome range, release to reset, and fresh defaults');

    // Seed only the starting setting to reach the integer boundary without
    // billions of taps; the live arrows, clamping, randomness, and render are unchanged.
    const boundary = await context.newPage();
    boundary.on('pageerror', error => errors.push(error.message));
    await boundary.route('**/app.js', async route => {
        const body = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
        const fixture = body.replace("count = currentMode === 'number' ? 100 :", "count = currentMode === 'number' ? 0xFFFFFFFF :");
        assert.notEqual(fixture, body, 'The boundary fixture only changes the initial maximum');
        await route.fulfill({ body: fixture, contentType: 'application/javascript' });
    });
    await boundary.setViewportSize({ width: 320, height: 740 });
    await boundary.goto(address);
    await mode(boundary, 'number');
    assert.equal(await value(boundary), 0xFFFFFFFF);
    await boundary.locator('#up-arrow').tap();
    assert.equal(await value(boundary), 0x100000000);
    assert.equal(await boundary.locator('#up-arrow').isDisabled(), true);
    const bounds = await boundary.locator('#winner-selector-container').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320, 'The largest range fits on a narrow phone');
    const boundarySession = await context.newCDPSession(boundary);
    await roll(boundary, boundarySession, 0xFFFFFFFF, 0x100000000);
    const resultBounds = await boundary.locator('#result-value').boundingBox();
    assert.ok(resultBounds.x >= 0 && resultBounds.x + resultBounds.width <= 320, 'Long outcomes fit without wrapping');
    await releaseResult(boundary, boundarySession);
    console.log('PASS maximum supported range stays bounded, picks its highest value, and fits a 320px screen');
    assert.deepEqual(errors, [], 'No browser JavaScript errors');
    await context.close();
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
        await run(browser, `http://127.0.0.1:${server.address().port}/`);
        console.log('All number-range regressions passed.');
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
