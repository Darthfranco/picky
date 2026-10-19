#!/usr/bin/env node
// Real touch regressions for Teams, Teams 5+, and Ranking. No app dependencies.
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
const review = process.env.PICKY_REVIEW_DIR || path.join(root, '.impeccable/review');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const file = path.resolve(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || 'index.html');
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, body) => {
        res.writeHead(error ? 404 : 200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(error ? 'Not found' : body);
    });
});

async function touch(session, type, points = []) {
    await session.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([x, y], id) => ({ id, x, y, radiusX: 12, radiusY: 12, force: 1 }))
    });
}

// CDP touchEnd lists the contacts being lifted, not the contacts that remain.
async function release(session, points, indices) {
    await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: indices.map(id => ({ id, x: points[id][0], y: points[id][1], radiusX: 12, radiusY: 12, force: 1 }))
    });
}

async function mode(page, id) {
    await page.locator('.mode-switcher').click();
    await page.locator('.more-tab').click();
    await page.locator(`.mode-row[data-mode="${id}"]`).click();
    assert.equal(await page.locator('#game-container').getAttribute('data-mode'), id);
}

async function visible(page, selector) {
    return page.locator(selector).evaluateAll(elements => elements.some(element => {
        for (let node = element; node instanceof Element; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        }
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
    }));
}

async function minimal(page, label) {
    await page.waitForFunction(() => {
        const nav = document.querySelector('#game-mode-switcher');
        const style = getComputedStyle(nav);
        return nav.hidden || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
    }, null, { timeout: 500 }).catch(async error => {
        const state = await page.evaluate(() => ({
            phase: document.querySelector('#party-layer')?.dataset.phase,
            players: document.querySelectorAll('.party-dot').length,
            navClass: document.querySelector('#game-mode-switcher').className,
            navOpacity: getComputedStyle(document.querySelector('#game-mode-switcher')).opacity,
            navVisibility: getComputedStyle(document.querySelector('#game-mode-switcher')).visibility
        }));
        throw new Error(`${label}: navigation did not finish fading: ${JSON.stringify(state)}; ${error.message}`);
    });
    for (const selector of ['#picky-logo', '#game-mode-switcher', '#party-up', '#party-down', '#party-pick', '#party-undo', '#party-clear']) {
        assert.equal(await visible(page, selector), false, `${label}: ${selector} disappears`);
    }
    assert.equal(await visible(page, '#result-screen'), false, `${label}: no separate result screen or captions`);
    assert.equal(await page.locator('#play-again').count(), 0, `${label}: no Again button`);
}

async function dotPositions(page, expected, reason) {
    const dots = await page.locator('.party-dot').evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        return [box.x + box.width / 2, box.y + box.height / 2];
    }));
    assert.equal(dots.length, expected.length, `${reason}: no missing or extra players`);
    for (let index = 0; index < expected.length; index++) {
        assert.ok(Math.hypot(dots[index][0] - expected[index][0], dots[index][1] - expected[index][1]) <= 2,
            `${reason}: player ${index + 1} stays at the touch (${expected[index]}) instead of (${dots[index]})`);
    }
}

async function waitTeams(page, size) {
    await page.waitForFunction(size => {
        const dots = [...document.querySelectorAll('.party-dot')];
        return dots.length === size && dots.every(dot => Number(dot.dataset.team) > 0);
    }, size, { timeout: 5000 });
}

async function checkTeams(page, expectedSizes) {
    const diagram = await page.evaluate(() => {
        const dots = [...document.querySelectorAll('.party-dot')].map(dot => {
            const box = dot.getBoundingClientRect();
            return { team: Number(dot.dataset.team), x: box.x + box.width / 2, y: box.y + box.height / 2 };
        });
        const lines = [...document.querySelectorAll('#party-links line')].map(line => {
            const transform = line.getScreenCTM();
            const from = new DOMPoint(line.x1.baseVal.value, line.y1.baseVal.value).matrixTransform(transform);
            const to = new DOMPoint(line.x2.baseVal.value, line.y2.baseVal.value).matrixTransform(transform);
            return [[from.x, from.y], [to.x, to.y]];
        });
        return { dots, lines };
    });
    const groups = new Map();
    diagram.dots.forEach((dot, index) => {
        assert.ok(dot.team >= 1 && dot.team <= expectedSizes.length);
        if (!groups.has(dot.team)) groups.set(dot.team, []);
        groups.get(dot.team).push(index);
    });
    assert.deepEqual([...groups.values()].map(group => group.length).sort(), [...expectedSizes].sort(), 'Remainders produce balanced teams');
    const graph = diagram.dots.map(() => new Set());
    for (const [start, end] of diagram.lines) {
        const endpoints = [start, end].map(([x, y]) => {
            const index = diagram.dots.findIndex(dot => Math.hypot(dot.x - x, dot.y - y) <= 3);
            assert.notEqual(index, -1, 'Each connecting line ends on a player');
            return index;
        });
        assert.notEqual(endpoints[0], endpoints[1], 'A line connects two distinct players');
        assert.equal(diagram.dots[endpoints[0]].team, diagram.dots[endpoints[1]].team, 'Lines never connect opposing teams');
        graph[endpoints[0]].add(endpoints[1]);
        graph[endpoints[1]].add(endpoints[0]);
    }
    for (const members of groups.values()) {
        const reached = new Set([members[0]]);
        const queue = [members[0]];
        for (const member of queue) {
            for (const connected of graph[member]) {
                if (!reached.has(connected)) { reached.add(connected); queue.push(connected); }
            }
        }
        assert.equal(reached.size, members.length, 'Every team is visibly connected');
    }
}

async function screenshot(page, id, viewport, theme) {
    fs.mkdirSync(review, { recursive: true });
    await page.screenshot({ path: path.join(review, `party-${id}-${theme}-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
}

async function backgroundAndReturn(page) {
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

async function run(browser, address, viewport, theme, comprehensive) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    try {
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(theme => localStorage.setItem('picky.preferences.v1', JSON.stringify({ theme, pinned: ['finger', 'wheel'] })), theme);
        await page.goto(address, { waitUntil: 'load' });
        const point = (x, y) => [Math.round(viewport.width * x), Math.round(viewport.height * y)];
        const positions = [point(.19, .39), point(.69, .37), point(.44, .51), point(.21, .66), point(.78, .65)];

        await mode(page, 'teams');
        assert.equal((await page.locator('#party-count').textContent()).trim(), '2');
        await touch(session, 'touchStart', positions);
        await page.waitForTimeout(260);
        await minimal(page, 'Team charge');
        await waitTeams(page, 5);
        await checkTeams(page, [3, 2]);
        await dotPositions(page, positions, 'Live teams');
        await minimal(page, 'Team result');
        await screenshot(page, 'teams', viewport, theme);
        const withExtra = [...positions, point(.89, .48)];
        await touch(session, 'touchStart', withExtra);
        assert.equal(await page.locator('.party-dot').count(), 5, 'A late finger cannot change completed teams');
        await release(session, withExtra, [1, 2, 3, 4, 5]);
        await page.waitForTimeout(1700);
        assert.equal(await page.locator('.party-dot').count(), 5, 'Teams remain until the last finger lifts');
        await touch(session, 'touchEnd');
        await page.waitForTimeout(700);
        assert.equal(await page.locator('.party-dot').count(), 5, 'Team result lingers for reading after release');
        await page.waitForFunction(() => !document.querySelector('.party-dot'), null, { timeout: 1800 });
        assert.equal((await page.locator('#party-count').textContent()).trim(), '2');

        if (comprehensive) {
            await page.locator('#party-up').click();
            await touch(session, 'touchStart', positions.slice(0, 3));
            await page.waitForTimeout(220);
            await release(session, positions, [1, 2]);
            await page.waitForTimeout(2700);
            assert.equal(await page.locator('.party-dot[data-team]').count(), 0, 'Insufficient remaining players cancel the countdown');
            await touch(session, 'touchEnd');
            assert.equal((await page.locator('#party-count').textContent()).trim(), '3', 'Canceled rounds preserve team count');
            await mode(page, 'finger');
            await mode(page, 'teams');
            assert.equal((await page.locator('#party-count').textContent()).trim(), '2', 'Mode changes restore defaults');
            const nine = Array.from({ length: 9 }, (_, index) => point(.15 + index % 3 * .35, .35 + Math.floor(index / 3) * .15));
            await touch(session, 'touchStart', nine);
            await page.waitForTimeout(2700);
            assert.equal(await page.locator('.party-dot').count(), 9, 'Over-capacity rosters retain every player');
            assert.equal(await page.locator('.party-dot[data-team]').count(), 0, 'Over-capacity rosters do not silently pick a subset');
            assert.equal(await visible(page, '#party-up'), true, 'Team count can be increased when more capacity is needed');
            assert.match(await page.locator('#party-layer').textContent(), /Add a team/i);
            await page.locator('#party-up').click();
            await waitTeams(page, 9);
            await checkTeams(page, [3, 3, 3]);
            await touch(session, 'touchEnd');
            await page.waitForFunction(() => !document.querySelector('.party-dot'), null, { timeout: 2500 });
            // Chrome's native touch injector supports at most 16 contacts.
            // Exercise its full limit here; the tap roster covers 20 below.
            await page.locator('#party-up').click();
            const sixteen = Array.from({ length: 16 }, (_, index) => point(.12 + index % 4 * .25, .34 + Math.floor(index / 4) * .11));
            await touch(session, 'touchStart', sixteen);
            await waitTeams(page, 16);
            await checkTeams(page, [4, 4, 4, 4]);
            await touch(session, 'touchEnd');
            await page.waitForFunction(() => !document.querySelector('.party-dot'), null, { timeout: 2500 });
            await backgroundAndReturn(page);
            assert.equal((await page.locator('#party-count').textContent()).trim(), '2', 'Reopening resets team settings');
        }

        await mode(page, 'ranking');
        await touch(session, 'touchStart', comprehensive ? [...positions, point(.89, .48)] : positions);
        if (comprehensive) {
            await page.waitForTimeout(2700);
            assert.equal(await page.locator('#party-layer').getAttribute('data-phase'), 'waiting', 'Six fingers cannot silently rank only five');
            assert.equal(await page.locator('.party-rank').count(), 0);
            assert.match(await page.locator('#party-layer').textContent(), /5 fingers max/i);
            await release(session, [...positions, point(.89, .48)], [5]);
        }
        await page.waitForTimeout(260);
        await minimal(page, 'Ranking charge');
        assert.equal(await page.locator('.party-dot').count(), 5, 'Ranking accepts at most five fingers');
        await page.waitForFunction(() => document.querySelectorAll('.party-rank').length === 5, null, { timeout: 5000 });
        const ranks = await page.locator('.party-rank').allTextContents();
        assert.deepEqual(ranks.map(Number).sort((a, b) => a - b), [1, 2, 3, 4, 5], 'Every finger receives a unique rank');
        await dotPositions(page, positions, 'Ranked fingers');
        await minimal(page, 'Ranking result');
        await screenshot(page, 'ranking', viewport, theme);
        await touch(session, 'touchEnd');
        await page.waitForTimeout(700);
        assert.equal(await page.locator('.party-rank').count(), 5, 'Ranks linger after fingers lift');
        await page.waitForFunction(() => !document.querySelector('.party-dot'), null, { timeout: 1800 });

        await mode(page, 'teams-group');
        assert.equal(await page.locator('#party-pick').isDisabled(), true);
        for (const position of positions) {
            await touch(session, 'touchStart', [position]);
            await touch(session, 'touchEnd');
        }
        await page.waitForTimeout(280);
        await dotPositions(page, positions, 'Teams 5+ claims positions');
        assert.deepEqual(await page.locator('.party-dot').evaluateAll(dots => dots.map(dot => Number(dot.dataset.player))), [1, 2, 3, 4, 5], 'Player numbers follow join order');
        const pickBox = await page.locator('#party-pick').boundingBox();
        const pickPoint = [pickBox.x + pickBox.width / 2, pickBox.y + pickBox.height / 2];
        await touch(session, 'touchStart', [pickPoint]);
        await page.waitForTimeout(220);
        await touch(session, 'touchEnd');
        await page.waitForTimeout(2700);
        assert.equal(await page.locator('.party-dot[data-team]').count(), 0, 'Lifting Pick early cancels selection');
        await dotPositions(page, positions, 'Canceled Pick retains all players');
        await touch(session, 'touchStart', [pickPoint]);
        await page.waitForTimeout(260);
        await minimal(page, 'Teams 5+ charge');
        await waitTeams(page, 5);
        await checkTeams(page, [3, 2]);
        await screenshot(page, 'teams-group', viewport, theme);
        await touch(session, 'touchEnd');
        await page.waitForTimeout(700);
        assert.equal(await page.locator('.party-dot[data-team]').count(), 5, 'Teams 5+ results linger after Pick release');
        await page.waitForFunction(() => !document.querySelector('.party-dot[data-team]'), null, { timeout: 1800 });
        await dotPositions(page, positions, 'Teams 5+ keeps the roster for the next selection');
        assert.equal((await page.locator('#party-count').textContent()).trim(), '2');
        if (comprehensive) {
            await page.locator('#party-pick').focus();
            await page.keyboard.down('Enter');
            await waitTeams(page, 5);
            await page.keyboard.up('Enter');
            await page.waitForTimeout(700);
            assert.equal(await page.locator('.party-dot[data-team]').count(), 5, 'Keyboard Pick also keeps results readable after release');
            await page.waitForFunction(() => !document.querySelector('.party-dot[data-team]'), null, { timeout: 1800 });
            await dotPositions(page, positions, 'Keyboard Pick retains the claimed roster');
        }
        await page.locator('#party-undo').click();
        await dotPositions(page, positions.slice(0, 4), 'Undo removes only the last player');
        await page.locator('#party-clear').click();
        assert.equal(await page.locator('.party-dot').count(), 0);
        assert.equal(await page.locator('#party-pick').isDisabled(), true);

        if (comprehensive) {
            await page.locator('#party-dots').focus();
            await page.keyboard.press('Enter');
            await page.keyboard.press('Space');
            assert.equal(await page.locator('.party-dot').count(), 2, 'Keyboard players can join Teams 5+');
            assert.equal(await page.locator('#party-pick').isEnabled(), true);
            await page.locator('#party-clear').click();
            const twenty = Array.from({ length: 20 }, (_, index) => point(.1 + index % 5 * .2, .34 + Math.floor(index / 5) * .11));
            for (const position of twenty) {
                await touch(session, 'touchStart', [position]);
                await touch(session, 'touchEnd');
            }
            assert.equal(await page.locator('.party-dot').count(), 20, 'Large rosters retain all 20 players before teams are chosen');
            assert.equal(await page.locator('#party-pick').isDisabled(), true, 'Pick waits for enough teams');
            await touch(session, 'touchStart', [point(.47, .74)]);
            await touch(session, 'touchEnd');
            assert.equal(await page.locator('.party-dot').count(), 20, 'A 21st tap never silently replaces another player');
            assert.match(await page.locator('#party-layer').textContent(), /20 players max/i);
            await page.locator('#party-up').click({ clickCount: 3 });
            assert.equal((await page.locator('#party-count').textContent()).trim(), '5');
            assert.equal(await page.locator('#party-up').isDisabled(), true, 'Five is the maximum team count');
            assert.equal(await page.locator('#party-down').isDisabled(), true, 'Count cannot shrink below roster capacity');
            assert.equal(await page.locator('#party-pick').isEnabled(), true);
            await touch(session, 'touchStart', [pickPoint]);
            await page.waitForTimeout(220);
            await backgroundAndReturn(page);
            await touch(session, 'touchEnd');
            await page.waitForTimeout(2700);
            assert.equal(await page.locator('.party-dot').count(), 0, 'Reopening clears the claimed roster');
            assert.equal((await page.locator('#party-count').textContent()).trim(), '2', 'Reopening restores two teams');
            assert.equal(await page.locator('#party-layer').getAttribute('data-phase'), 'waiting', 'A canceled charge cannot reveal an old result in a reopened app');
        }
        assert.deepEqual(errors, [], 'No browser JavaScript errors');
        console.log(`PASS Teams, Teams 5+, and Ranking (${viewport.width}×${viewport.height}, ${theme})`);
    } finally { await context.close(); }
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
        const address = `http://127.0.0.1:${server.address().port}/`;
        for (const viewport of [{ width: 414, height: 896 }, { width: 844, height: 390 }]) {
            for (const theme of ['dark', 'light']) await run(browser, address, viewport, theme, viewport.width === 414 && theme === 'dark');
        }
        console.log('All party gameplay regressions passed.');
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
