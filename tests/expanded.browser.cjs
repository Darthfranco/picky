#!/usr/bin/env node
// End-to-end regression coverage for the additional modes, preferences, and offline bundle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
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
    const relative = pathname.startsWith('/Picky/') ? pathname.slice(7) : pathname.slice(1);
    const file = path.resolve(root, relative || 'index.html');
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, body) => {
        res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(error ? 'Not found' : body);
    });
});

async function touch(session, type, points = [[207, 440]]) {
    await session.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : points.map((point, id) => ({ id, x: point[0], y: point[1], radiusX: 12, radiusY: 12, force: 1 }))
    });
}

async function changeMode(page, id) {
    await page.locator('.mode-switcher').click();
    await page.locator('.more-tab').click();
    await page.locator(`.mode-row[data-mode="${id}"]`).click();
    assert.equal(await page.locator('#game-container').getAttribute('data-mode'), id);
}

async function openSettings(page) {
    await page.locator('.mode-switcher').click();
    await page.locator('.more-tab').click();
    await page.locator('.settings-link').click();
}

async function closeSettings(page) {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
}

async function assertPinnedModes(page, expected) {
    const current = await page.locator('.mode-switcher').getAttribute('data-mode');
    await page.locator('.mode-switcher').click();
    const choices = await page.locator('#mode-popup .mode-tab[data-mode]').evaluateAll(tabs => tabs.map(tab => tab.dataset.mode));
    if (expected.includes(current)) choices.push(current);
    assert.deepEqual(choices.sort(), [...expected].sort(), 'The current pill and popup preserve the pinned modes');
    await page.keyboard.press('Escape');
}

async function deterministicRandom(page, value) {
    await page.evaluate(value => {
        window.originalRandom ??= crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues = array => { array.fill(value); return array; };
    }, value);
}

async function visibleChrome(page) {
    return page.evaluate(() => {
        const selectors = ['#picky-logo', '#winner-selector-container', '#mode-settings', '#game-mode-switcher', '#hold-hint', '#hold-progress', '#group-hint', '#group-actions'];
        return selectors.filter(selector => {
            const element = document.querySelector(selector);
            if (!element || !element.getBoundingClientRect().width || !element.getBoundingClientRect().height) return false;
            for (let node = element; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= .01) return false;
            }
            return true;
        });
    });
}

async function roll(page, session) {
    assert.ok((await visibleChrome(page)).includes('#picky-logo'), 'The idle game shows the Picky wordmark');
    const start = performance.now();
    await touch(session, 'touchStart');
    await page.waitForTimeout(300);
    assert.deepEqual(await visibleChrome(page), [], 'Charging hides the logo, settings, navigation, hints, and progress bar');
    await page.locator('#result-screen').waitFor({ state: 'visible', timeout: 6000 });
    const duration = performance.now() - start;
    assert.equal((await visibleChrome(page)).includes('#picky-logo'), false, 'The result screen hides the Picky wordmark');
    await assertMinimalResult(page);
    if (process.env.PICKY_REVIEW_DIR) {
        fs.mkdirSync(process.env.PICKY_REVIEW_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.PICKY_REVIEW_DIR, `${await page.locator('#game-container').getAttribute('data-mode')}-result.png`) });
    }
    return { duration, value: (await page.locator('#result-value').textContent()).trim() };
}

async function assertMinimalResult(page) {
    assert.equal(await page.locator('#play-again').count(), 0, 'There is no replay button');
    const extraText = await page.locator('#result-screen').evaluate(result => {
        const copy = result.cloneNode(true);
        copy.querySelector('#result-value')?.remove();
        return copy.textContent.trim();
    });
    assert.equal(extraText, '', 'Results contain only the outcome numbers');
}

async function releaseResult(page, session) {
    await touch(session, 'touchEnd');
    assert.equal(await page.locator('#result-screen').isHidden(), true, 'Lifting the initiating finger immediately clears the result');
    assert.ok((await visibleChrome(page)).includes('#picky-logo'), 'Releasing restores the idle wordmark');
}

async function startGroupPick(page, session) {
    await page.locator('#group-pick').tap();
}

async function assertInterruptedRoll(page, session, releaseType = 'touchEnd') {
    await touch(session, 'touchStart');
    await page.waitForFunction(() => {
        const game = document.getElementById('game-container');
        return game.classList.contains('playing') && !game.classList.contains('holding');
    });
    await touch(session, releaseType);
    assert.equal(await page.locator('#result-screen').isHidden(), true);
    assert.ok((await visibleChrome(page)).includes('#picky-logo'), 'Releasing during an animation restores idle immediately');
    await page.waitForTimeout(2700);
    assert.equal(await page.locator('#result-screen').isHidden(), true, 'A cancelled animation cannot reveal a late result');
}

async function assertSecondaryContact(page, session) {
    const point = (id, x, y) => ({ id, x, y, radiusX: 12, radiusY: 12, force: 1 });
    await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [point(0, 207, 440), point(1, 280, 520)]
    });
    assert.equal(await page.locator('#result-screen').isVisible(), true, 'A second finger does not dismiss the result');
    await session.send('Input.dispatchTouchEvent', {
        // CDP touchEnd lists the contacts to lift, rather than those remaining.
        type: 'touchEnd', touchPoints: [point(1, 280, 520)]
    });
    assert.equal(await page.locator('#result-screen').isVisible(), true, 'Lifting a second finger does not dismiss the initiating finger’s result');
}

async function numberRoll(page, session) {
    await page.evaluate(() => {
        const game = document.getElementById('game-container');
        const result = document.getElementById('result-screen');
        const timing = window.numberRollTiming = { started: null, finished: null };
        let held = false;
        // Timestamp the app's actual hold-to-animation and animation-to-result
        // transitions in the browser. Playwright's polling/transport time is
        // unrelated to how long the number animation is visible to a player.
        const observer = new MutationObserver(() => {
            if (game.classList.contains('holding')) held = true;
            if (held && game.classList.contains('playing') && !game.classList.contains('holding') && result.hidden && timing.started === null) {
                timing.started = performance.now();
            }
            if (!result.hidden && timing.started !== null) {
                timing.finished = performance.now();
                observer.disconnect();
            }
        });
        observer.observe(game, { attributes: true, attributeFilter: ['class'] });
        observer.observe(result, { attributes: true, attributeFilter: ['hidden'] });
    });
    const result = await roll(page, session);
    const timing = await page.evaluate(() => window.numberRollTiming);
    assert.equal(typeof timing.started, 'number', 'The number animation started after a completed hold');
    assert.equal(typeof timing.finished, 'number', 'The number animation ended with a visible result');
    return { ...result, animationDuration: timing.finished - timing.started };
}

async function reopen(page) {
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
        delete document.hidden;
    });
}

async function run(browser, address) {
    const context = await browser.newContext({ viewport: { width: 414, height: 896 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(address, { waitUntil: 'load' });

    await changeMode(page, 'dice');
    assert.equal(await page.locator('#dice-options [aria-pressed="true"]').textContent(), 'd6');
    await page.locator('#dice-options [data-sides="20"]').click();
    await touch(session, 'touchStart');
    await page.waitForTimeout(250);
    await touch(session, 'touchEnd');
    await page.waitForTimeout(2700);
    assert.equal(await page.locator('#result-screen').isHidden(), true);
    assert.equal(await page.locator('#dice-options [aria-pressed="true"]').textContent(), 'd20');
    console.log('PASS early release cancels dice hold without resetting the selected die');
    await assertInterruptedRoll(page, session);
    assert.equal(await page.locator('#dice-options [aria-pressed="true"]').textContent(), 'd20');

    for (const sides of [6, 8, 12, 20]) {
        await page.locator(`#dice-options [data-sides="${sides}"]`).click();
        await deterministicRandom(page, sides - 1);
        const result = await roll(page, session);
        assert.equal(Number(result.value), sides, `d${sides} can select its highest face`);
        assert.ok(result.duration > 3500 && result.duration < 5500, `d${sides} uses the longer hold then roll (${Math.round(result.duration)} ms)`);
        if (sides === 6) await assertSecondaryContact(page, session);
        await releaseResult(page, session);
        assert.equal(await page.locator('#dice-options [aria-pressed="true"]').textContent(), `d${sides}`);
    }
    await page.locator('#dice-stage').focus();
    await page.keyboard.down('Space');
    await page.locator('#result-screen').waitFor({ state: 'visible', timeout: 6000 });
    await assertMinimalResult(page);
    await page.keyboard.up('Space');
    assert.equal(await page.locator('#result-screen').isHidden(), true, 'Releasing Space clears a keyboard-held dice result');
    assert.equal(await page.locator('#dice-options [aria-pressed="true"]').textContent(), 'd20');
    await reopen(page);
    assert.equal(await page.locator('#dice-options [aria-pressed="true"]').textContent(), 'd6');
    await page.locator('#dice-options [data-sides="12"]').click();
    await changeMode(page, 'finger');
    await changeMode(page, 'dice');
    assert.equal(await page.locator('#dice-options [aria-pressed="true"]').textContent(), 'd6');
    console.log('PASS d6/d8/d12/d20 minimal results, release preservation, reopen and mode-change resets');

    await changeMode(page, 'multi-dice');
    assert.equal((await page.locator('#winner-count').textContent()).trim(), '2');
    assert.equal(await page.locator('#dice-options').isHidden(), true, 'Multi Dice only uses d6');
    await assertInterruptedRoll(page, session, 'touchCancel');
    assert.equal((await page.locator('#winner-count').textContent()).trim(), '2');
    await page.locator('#down-arrow').click();
    for (const count of [1, 2, 3]) {
        assert.equal((await page.locator('#winner-count').textContent()).trim(), String(count));
        await deterministicRandom(page, 5);
        const result = await roll(page, session);
        assert.equal(Number(result.value), count * 6, `The total matches ${count} sixes`);
        await releaseResult(page, session);
        assert.equal((await page.locator('#winner-count').textContent()).trim(), String(count), 'Lifting preserves the dice count');
        if (count < 3) await page.locator('#up-arrow').click();
    }
    assert.equal(await page.locator('#up-arrow').isDisabled(), true, 'Multi Dice caps at three');
    await reopen(page);
    assert.equal((await page.locator('#winner-count').textContent()).trim(), '2');
    console.log('PASS Multi Dice supports one to three d6s with a minimal total and release to reset');

    await changeMode(page, 'number');
    await assertInterruptedRoll(page, session);
    assert.equal((await page.locator('#number-value').textContent()).trim(), '0', 'Interrupted counting resets the central number');
    const numberDurations = [];
    for (const target of [1, 100]) {
        assert.equal((await page.locator('#number-value').textContent()).trim(), '0');
        await deterministicRandom(page, target - 1);
        const result = await numberRoll(page, session);
        assert.equal(Number(result.value), target);
        assert.ok(Math.abs(result.animationDuration - 1000) <= 150,
            `The number animation itself takes one second (${Math.round(result.animationDuration)} ms)`);
        numberDurations.push(result.animationDuration);
        await releaseResult(page, session);
    }
    assert.ok(Math.abs(numberDurations[0] - numberDurations[1]) <= 150,
        `Counting to 1 and 100 must take the same time (${numberDurations.map(Math.round).join(' / ')} ms)`);
    console.log(`PASS 1–100 endpoints use the same duration (${numberDurations.map(Math.round).join(' / ')} ms)`);

    await changeMode(page, 'group');
    for (let index = 0; index < 32; index++) {
        const point = [[40 + (index % 6) * 65, 270 + Math.floor(index / 6) * 65]];
        await touch(session, 'touchStart', point);
        await touch(session, 'touchEnd');
    }
    assert.equal(await page.locator('.group-entry').count(), 32);
    await page.waitForTimeout(280);
    const groupCenters = await page.locator('.group-entry').evaluateAll(entries => entries.map(entry => {
        const box = entry.getBoundingClientRect();
        return [box.x + box.width / 2, box.y + box.height / 2];
    }));
    groupCenters.forEach(([x, y], index) => {
        assert.ok(Math.abs(x - (40 + (index % 6) * 65)) <= 2 && Math.abs(y - (270 + Math.floor(index / 6) * 65)) <= 2,
            `Player ${index + 1} remains centered at their original touch`);
    });
    assert.equal(await page.locator('#group-entries').evaluate(list => list.scrollTop), 0, 'Adding a player does not scroll the touch surface');
    const roster = (await page.locator('.group-entry').allTextContents()).map(value => Number(value.trim()));
    assert.deepEqual(roster, Array.from({ length: 32 }, (_, index) => index + 1));
    await page.locator('#group-undo').click();
    assert.equal(await page.locator('.group-entry').count(), 31);
    await page.locator('#up-arrow').click({ clickCount: 2 });
    assert.equal((await page.locator('#winner-count').textContent()).trim(), '3');
    await startGroupPick(page, session);
    await page.waitForTimeout(300);
    assert.deepEqual(await visibleChrome(page), [], 'Picking a group winner hides surrounding controls and the wordmark');
    await page.waitForFunction(() => document.querySelectorAll('.group-entry.chosen').length === 3, null, { timeout: 4500 });
    const winners = await page.locator('.group-entry.chosen').evaluateAll(entries => entries.map(entry => Number(entry.dataset.number)));
    assert.equal(winners.length, 3);
    assert.equal(new Set(winners).size, 3);
    assert.ok(winners.every(value => value >= 1 && value <= 31));
    assert.equal(await page.locator('#result-screen').isHidden(), true, 'Group winners stay on their original bubbles');
    assert.ok(await page.locator('#game-container').evaluate(game => game.style.background), 'The chosen colors fill the background');
    assert.equal(await page.locator('#play-again').count(), 0);
    await page.waitForFunction(() => !document.querySelector('.group-entry.chosen'), null, { timeout: 3500 });
    assert.equal(await page.locator('.group-entry').count(), 31, 'Repicking preserves the full roster');
    await page.locator('#group-clear').click();
    assert.equal(await page.locator('.group-entry').count(), 0);
    assert.equal(await page.locator('#group-pick').isDisabled(), true);
    console.log('PASS Finger 5+ remembers 32 sequential taps, undo, multiple distinct winners, repick, and clear');

    await openSettings(page);
    await page.locator('[data-theme="light"]').click();
    await page.locator('.pin-row[data-mode="dice"]').click();
    assert.equal(await page.locator('.pin-count').textContent(), '3 / 3');
    await closeSettings(page);
    await assertPinnedModes(page, ['finger', 'wheel', 'dice']);
    await changeMode(page, 'finger');
    const lightLogo = await page.locator('#picky-logo').getAttribute('src');
    assert.notEqual(lightLogo, './PickyNB.png');
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
    await page.reload({ waitUntil: 'load' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await assertPinnedModes(page, ['finger', 'wheel', 'dice']);
    console.log('PASS light theme, toon wordmark, and three pinned modes survive reloading');

    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => {
        const names = await caches.keys();
        const cache = await caches.open(names.find(name => name.startsWith(`picky:${location.origin}/Picky/:`)));
        return (await cache.keys()).map(request => new URL(request.url).pathname);
    });
    for (const required of ['index.html', 'styles.css', 'navigation.js', 'app.js', 'dice-renderer.js', 'assets/dice/models.json']) {
        assert.ok(cached.includes(`/Picky/${required}`), `${required} is in the offline bundle`);
    }
    assert.ok(cached.some(file => /toon.*\.(png|webp)$/.test(file)), 'The light-theme wordmark is cached');
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load', timeout: 3000 });
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
    const offlineAssets = await page.evaluate(async urls => Promise.all(urls.map(async url => ({ url, status: (await fetch(url)).status }))), cached);
    assert.ok(offlineAssets.every(asset => asset.status === 200));
    await changeMode(page, 'dice');
    await deterministicRandom(page, 0);
    const offlineRoll = await roll(page, session);
    assert.equal(Number(offlineRoll.value), 1);
    console.log('PASS nested-path offline reload, every bundled asset, light wordmark, and 3D dice roll');
    assert.deepEqual(errors, [], 'No browser JavaScript errors');
    await context.close();
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
        await run(browser, `http://127.0.0.1:${server.address().port}/Picky/`);
        console.log('All expanded gameplay regressions passed.');
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
