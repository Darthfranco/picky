#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require(path.join(process.env.HOME, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = http.createServer((request, response) => {
    const file = path.resolve(root, decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1) || 'index.html');
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, content) => {
        response.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(error ? 'Not found' : content);
    });
});

async function touch(session, type, points = []) {
    await session.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ id, x, y, radiusX: 10, radiusY: 10, force: 1 })) });
}

async function openModes(page) {
    await page.locator('.mode-switcher').click();
    await page.locator('.more-tab').click();
}

async function assertClearBackground(page, reason) {
    assert.equal(await page.locator('#game-container').evaluate(game => game.style.background), '', reason);
}

async function run(browser, address, theme, total, viewport) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    try {
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(value => localStorage.setItem('picky.preferences.v1', JSON.stringify({ theme: value, pinned: ['finger', 'wheel'] })), theme);
        await page.goto(address, { waitUntil: 'load' });
        await openModes(page);
        assert.equal(await page.locator('.mode-row[data-mode="tournament"]').count(), 0, 'Only Tournament 5+ is offered');
        await page.locator('.mode-row[data-mode="tournament-group"]').click();
        const stage = page.locator('#tournament-stage');
        await page.evaluate(() => {
            const stage = document.querySelector('#tournament-stage');
            window.tournamentTiming = { phase: stage.dataset.phase, started: null, durations: [] };
            new MutationObserver(() => {
                const timing = window.tournamentTiming;
                if (timing.phase === stage.dataset.phase) return;
                timing.phase = stage.dataset.phase;
                if (timing.phase === 'holding') timing.started = performance.now();
                if (timing.phase === 'result') timing.durations.push(performance.now() - timing.started);
            }).observe(stage, { attributes: true, attributeFilter: ['data-phase'] });
        });
        assert.equal(await page.locator('#tournament-count').textContent(), '10');
        for (let count = 10; count !== total; count += total > 10 ? 1 : -1) {
            await page.locator(total > 10 ? '#tournament-up' : '#tournament-down').click();
        }
        assert.equal(await page.locator('#tournament-count').textContent(), String(total));
        assert.equal(await page.locator(total === 6 ? '#tournament-down' : '#tournament-up').isDisabled(), true, 'Total stays within 6–25');

        const positions = [[.23, .35], [.75, .36], [.5, .58], [.22, .75], [.78, .75], [.5, .28]]
            .map(([x, y]) => [Math.round(x * viewport.width), Math.round(y * viewport.height)]);
        const batchCount = Math.ceil(total / 5);
        const winners = [];
        let previousLast = 0;
        for (let round = 0; round < batchCount; round++) {
            const expected = Math.floor(total / batchCount) + (round < total % batchCount ? 1 : 0);
            assert.equal(await page.locator('#tournament-round').textContent(), `Round ${round + 1}`);
            assert.equal(await page.locator('#tournament-needed').textContent(), `Place ${expected} fingers`);
            if (round === 0 && total === 6) {
                await touch(session, 'touchStart', positions.slice(0, expected - 1));
                await page.waitForTimeout(2550);
                assert.equal(await stage.getAttribute('data-phase'), 'waiting', 'Partial batch never picks');
                await touch(session, 'touchStart', positions.slice(0, expected));
                await page.waitForTimeout(160);
                assert.equal(await stage.getAttribute('data-phase'), 'holding');
                await touch(session, 'touchEnd');
                await page.waitForTimeout(2550);
                assert.equal(await stage.getAttribute('data-phase'), 'waiting', 'Early lift cancels without a delayed winner');
                assert.equal(await page.locator('.tournament-dot').count(), 0);

                await touch(session, 'touchStart', positions.slice(0, expected));
                await page.waitForTimeout(160);
                assert.equal(await stage.getAttribute('data-phase'), 'holding');
                await page.evaluate(() => window.dispatchEvent(new Event('blur')));
                await touch(session, 'touchEnd');
                assert.equal(await page.locator('.tournament-dot').count(), 0, 'Focus loss clears interrupted contacts');
                await page.waitForTimeout(2550);
                assert.equal(await stage.getAttribute('data-phase'), 'waiting', 'Focus loss cancels the charge without a delayed selection');
                assert.equal(await page.locator('#tournament-round').textContent(), 'Round 1', 'Focus loss preserves the current round');
                assert.equal(await page.locator('#tournament-count').textContent(), '6', 'Focus loss preserves the chosen total');
                await assertClearBackground(page, 'Focus loss clears the result background');

                await touch(session, 'touchStart', positions.slice(0, expected + 1));
                await page.waitForTimeout(2550);
                assert.equal(await stage.getAttribute('data-phase'), 'waiting', 'Extra contacts prevent selection');
                // CDP touchEnd names contacts to lift, not contacts remaining.
                await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id: expected, x: positions[expected][0], y: positions[expected][1] }] });
            } else {
                await touch(session, 'touchStart', positions.slice(0, expected));
            }
            await page.waitForTimeout(180);
            assert.equal(await stage.getAttribute('data-phase'), 'holding');
            assert.equal(await page.locator('#tournament-prompt').isHidden(), true, 'Prompts disappear during pulses');
            assert.equal(await page.locator('#tournament-controls').isHidden(), true, 'Settings disappear during pulses');
            assert.equal(await page.locator('#game-container').evaluate(game => game.classList.contains('charging')), true, 'Tournament uses the shared pulses');
            const numbers = await page.locator('.tournament-dot').evaluateAll(dots => dots.map(dot => Number(dot.dataset.number)));
            assert.deepEqual(numbers, Array.from({ length: expected }, (_, index) => previousLast + index + 1), 'New batches keep global player numbers');
            assert.deepEqual(await page.locator('.tournament-dot').allTextContents(), Array(expected).fill(''), 'Tournament dots never display ranks or player numbers');
            previousLast += expected;
            await page.waitForFunction(() => document.querySelector('#tournament-stage').dataset.phase === 'result');
            const chosen = page.locator('.tournament-dot[data-winner="true"]');
            const winner = await chosen.evaluate(dot => ({ number: Number(dot.dataset.number), color: dot.style.getPropertyValue('--player-color') }));
            winners.push(winner);
            assert.ok(numbers.includes(winner.number));
            assert.equal(await page.locator('.tournament-dot[data-winner="true"]').count(), 1);
            assert.equal(await page.locator('.tournament-dot.loser').count(), expected - 1, 'Other fingers use the original burst animation');
            assert.equal(await chosen.evaluate(dot => {
                const sample = document.createElement('div');
                sample.style.background = dot.style.getPropertyValue('--player-color');
                return document.querySelector('#game-container').style.background === sample.style.background;
            }), true, 'The winner color fills the screen like Finger mode');
            const duration = await page.evaluate(() => window.tournamentTiming.durations.at(-1));
            assert.ok(duration >= 2300 && duration <= 3000, `Buildup should last 2.4 seconds, measured ${duration} ms`);
            assert.deepEqual(await page.locator('.tournament-dot').allTextContents(), Array(expected).fill(''), 'Result has no rank labels');
            if (round === 0 && total === 6) {
                await touch(session, 'touchEnd', [positions[0]]);
                await page.waitForTimeout(200);
                assert.equal(await stage.getAttribute('data-phase'), 'result', 'Partially releasing a result does not advance it');
                await page.evaluate(() => window.dispatchEvent(new Event('blur')));
                assert.equal(await chosen.getAttribute('data-number'), String(winner.number), 'Focus loss retains the selected winner');
                await assertClearBackground(page, 'Focus loss removes the result color while retaining the winner');
            }
            await touch(session, 'touchEnd');
            if (round === 0) {
                await page.waitForTimeout(600);
                assert.equal(await stage.getAttribute('data-phase'), 'result', 'The result lingers after all fingers lift');
                await touch(session, 'touchStart', [positions[0]]);
                await touch(session, 'touchEnd');
                assert.equal(await page.locator('.tournament-dot').count(), expected, 'New touches during readback do not join');
                await page.waitForTimeout(500);
                assert.equal(await stage.getAttribute('data-phase'), 'result', 'Readback lasts at least one second');
            }
            await page.waitForFunction(() => document.querySelector('#tournament-stage').dataset.phase === 'waiting');
            assert.equal(await page.locator('.tournament-dot').count(), 0, 'Each round starts with a clear surface');
            await assertClearBackground(page, 'Advancing restores the normal game background');
        }

        assert.equal(previousLast, total, 'Every entrant plays exactly one opening round');
        assert.equal(await page.locator('#tournament-round').textContent(), 'Winners bracket');
        assert.equal(await page.locator('#tournament-needed').textContent(), `Place ${winners.length} fingers`);
        await touch(session, 'touchStart', positions.slice(0, winners.length));
        const finalists = await page.locator('.tournament-dot').evaluateAll(dots => dots.map(dot => ({ number: Number(dot.dataset.number), color: dot.style.getPropertyValue('--player-color') })));
        assert.deepEqual(finalists, winners, 'Returning winners retain their numbers and colors in join order');
        await page.waitForFunction(() => document.querySelector('#tournament-stage').dataset.phase === 'result');
        await page.waitForTimeout(450);
        assert.equal(await page.locator('.tournament-dot').evaluateAll(dots => dots.filter(dot => Number(getComputedStyle(dot).opacity) > .05).length), 1, 'Final result shows only the champion after other fingers burst');
        const champion = await page.locator('.tournament-dot[data-winner="true"]').getAttribute('data-number');
        assert.ok(winners.some(player => String(player.number) === champion));
        if (process.env.PICKY_REVIEW_DIR) {
            fs.mkdirSync(process.env.PICKY_REVIEW_DIR, { recursive: true });
            await page.screenshot({ path: path.join(process.env.PICKY_REVIEW_DIR, `tournament-${theme}-${viewport.width}.png`) });
        }
        await touch(session, 'touchEnd');
        await page.waitForFunction(() => document.querySelector('#tournament-stage').dataset.phase === 'waiting');
        assert.equal(await page.locator('#tournament-round').textContent(), 'Round 1');
        assert.equal(await page.locator('#tournament-count').textContent(), String(total), 'Finishing preserves the chosen total');
        await assertClearBackground(page, 'A fresh tournament starts without a winner background');
        await openModes(page);
        await page.locator('.mode-row[data-mode="finger"]').click();
        assert.equal(await stage.isHidden(), true);
        await assertClearBackground(page, 'Leaving tournament clears its background');
        await openModes(page);
        await page.locator('.mode-row[data-mode="tournament-group"]').click();
        assert.equal(await page.locator('#tournament-count').textContent(), '10', 'Reentering resets tournament settings');
        assert.deepEqual(errors, []);
        console.log(`PASS Tournament 5+: ${total} entrants, ${batchCount} rounds, automatic winners bracket, release/readback (${theme}, ${viewport.width}×${viewport.height})`);
    } finally { await context.close(); }
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
        const address = `http://127.0.0.1:${server.address().port}/`;
        await run(browser, address, 'dark', 6, { width: 414, height: 896 });
        await run(browser, address, 'light', 25, { width: 844, height: 390 });
        console.log('All tournament regressions passed.');
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
