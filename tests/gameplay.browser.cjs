#!/usr/bin/env node
// Run with Node and Playwright available through NODE_PATH, or the bundled Codex runtime.
// CHROME_PATH can override the installed browser. No test dependencies are added to Picky.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

let playwright;
try {
    playwright = require('playwright');
} catch {
    playwright = require(path.join(process.env.HOME,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
}

const root = path.resolve(__dirname, '..');
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css',
    '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
let delayNetwork = false;
const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname.startsWith('/Picky/') ? pathname.slice('/Picky/'.length) : pathname.slice(1);
    const file = path.resolve(root, relative || 'index.html');
    if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
    }
    const serve = () => {
        fs.readFile(file, (error, data) => {
            res.writeHead(error ? 404 : 200, {
                'Content-Type': mimeTypes[path.extname(file)] || 'application/octet-stream',
                'Cache-Control': 'no-store',
            });
            res.end(error ? 'Not found' : data);
        });
    };
    // Long enough to distinguish a cache response from waiting for the network.
    if (delayNetwork) setTimeout(serve, 4000).unref();
    else serve();
});

function check(label, callback) {
    return Promise.resolve().then(callback).then(() => console.log(`PASS ${label}`));
}

async function settings(page, count, label, loser = false) {
    assert.equal((await page.locator('#winner-count').textContent()).trim(), String(count));
    if (label) assert.equal((await page.locator('#winner-label').textContent()).trim(), label);
    assert.equal(await page.locator('#reverse-button').evaluate(el => el.classList.contains('toggled')), loser);
}

async function changeMode(page, mode) {
    await page.locator('.mode-switcher').click();
    await page.locator('.more-tab').click();
    await page.locator(`.mode-row[data-mode="${mode}"]`).click();
    assert.equal(await page.locator('.finger-circle').count(), 0);
}

async function touch(session, type, points = []) {
    await session.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((point, id) => ({ id, x: point[0], y: point[1], radiusX: 12, radiusY: 12, force: 1 })),
    });
}

const twoPoints = [[85, 510], [305, 510]];
const fourPoints = [[65, 500], [165, 575], [270, 500], [350, 650]];

async function releaseRound(page, session, type = 'touchEnd', points = twoPoints) {
    await touch(session, 'touchStart', points);
    assert.equal(await page.locator('.finger-circle').count(), points.length, 'Browser registered every finger');
    await touch(session, type);
    assert.equal(await page.locator('.finger-circle').count(), 0, 'Releasing/cancelling clears the round');
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

async function verifyGameplay(browser, base) {
    const context = await browser.newContext({ viewport: { width: 414, height: 896 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'load' });
    const session = await context.newCDPSession(page);
    await check('initial finger mode has one winner', () => settings(page, 1, 'Winner'));
    await page.locator('#up-arrow').click({ clickCount: 2 });
    await page.locator('#reverse-button').click();
    await settings(page, 3, 'Losers', true);

    await check('two-finger release keeps finger count and loser setting', async () => {
        await releaseRound(page, session);
        await settings(page, 3, 'Losers', true);
    });
    await check('touch cancellation keeps finger count and loser setting', async () => {
        await releaseRound(page, session, 'touchCancel');
        await settings(page, 3, 'Losers', true);
    });
    await check('completed finger round keeps settings for the next round', async () => {
        await touch(session, 'touchStart', fourPoints);
        await page.locator('.finger-circle.chosen').waitFor({ state: 'attached', timeout: 6500 });
        assert.equal(await page.locator('.finger-circle.chosen').count(), 1, 'Three losers leave one of four players');
        await touch(session, 'touchEnd');
        await settings(page, 3, 'Losers', true);
        assert.equal(await page.locator('.finger-circle').count(), 0);
    });
    await check('switching modes applies each mode default', async () => {
        await changeMode(page, 'wheel');
        assert.equal(await page.locator('#winner-selector-container').isHidden(), true, 'Wheel has no player-count setting');
        await changeMode(page, 'four-way');
        await settings(page, 4, null);
        await changeMode(page, 'finger');
        await settings(page, 1, 'Winner');
    });
    await check('4-Way picks one player on each side, then one final winner', async () => {
        await changeMode(page, 'four-way');
        await touch(session, 'touchStart', [[80, 260], [305, 260], [80, 600], [305, 600]]);
        assert.equal(await page.locator('.finger-circle').count(), 4);
        await page.waitForFunction(() => document.querySelectorAll('.finger-circle.chosen').length === 2, null, { timeout: 5000 });
        await page.waitForFunction(() => document.querySelectorAll('.finger-circle.chosen').length === 1, null, { timeout: 5000 });
        await touch(session, 'touchEnd');
        assert.equal(await page.locator('.finger-circle').count(), 0);
        await settings(page, 4, null);
    });
    await changeMode(page, 'wheel');
    await check('wheel starts from the actual fingers and cancels on release', async () => {
        assert.equal(await page.locator('#winner-selector-container').isHidden(), true);
        await releaseRound(page, session);
        await releaseRound(page, session, 'touchCancel');
    });
    await check('wheel automatically uses two or four held fingers without setup', async () => {
        for (const points of [twoPoints, fourPoints]) {
            await touch(session, 'touchStart', points);
            assert.equal(await page.locator('.finger-circle').count(), points.length);
            await page.waitForTimeout(1350);
            assert.equal(await page.locator('.finger-circle.chosen').count(), 0, 'The longer charge has not finished at the old delay');
            if (points === fourPoints) {
                await page.waitForFunction(() => {
                    const wheel = document.getElementById('wheel-graphic');
                    return wheel.style.transform && wheel.style.transform !== 'rotate(0deg)';
                }, null, { timeout: 4500 });
                const ratio = await page.locator('#wheel-graphic').evaluate(wheel => parseFloat(getComputedStyle(wheel).width) / innerWidth);
                assert.ok(ratio >= .8 && ratio <= .84, `The portrait wheel fills about 82% of the width (${Math.round(ratio * 100)}%)`);
                const review = process.env.PICKY_REVIEW_DIR || path.join(root, '.impeccable/review');
                fs.mkdirSync(review, { recursive: true });
                await page.screenshot({ path: path.join(review, 'wheel-spinning-dark-414.png'), animations: 'disabled' });
            }
            await page.locator('.finger-circle.chosen').waitFor({ state: 'attached', timeout: 6500 });
            assert.equal(await page.locator('.finger-circle.chosen').count(), 1);
            await touch(session, 'touchEnd');
            assert.equal(await page.locator('.finger-circle').count(), 0);
        }
    });
    await check('reopening during a wheel spin cancels its result', async () => {
        await touch(session, 'touchStart', fourPoints);
        await page.waitForFunction(() => {
            const wheel = document.getElementById('wheel-graphic');
            return wheel.style.transform && wheel.style.transform !== 'rotate(0deg)';
        });
        await backgroundAndReturn(page);
        assert.equal(await page.locator('#winner-selector-container').isHidden(), true);
        assert.equal(await page.locator('.finger-circle').count(), 0);
        await touch(session, 'touchEnd');
        // The previous spin's result timer must not run in the reopened session.
        await page.waitForTimeout(4200);
        assert.equal(await page.locator('.finger-circle').count(), 0);
        assert.equal(await page.locator('#wheel-graphic').evaluate(el => el.style.transform), 'rotate(0deg)');
    });
    await check('reopening finger mode resets count and loser setting', async () => {
        await changeMode(page, 'finger');
        await page.locator('#up-arrow').click();
        await page.locator('#reverse-button').click();
        await backgroundAndReturn(page);
        await settings(page, 1, 'Winner');
    });
    await check('restoring from browser back-forward cache resets settings', async () => {
        await page.locator('#up-arrow').click();
        await page.locator('#reverse-button').click();
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await settings(page, 1, 'Winner');
    });
    await check('ordinary reload starts with default finger settings', async () => {
        await page.locator('#up-arrow').click();
        await page.locator('#reverse-button').click();
        await page.reload({ waitUntil: 'load' });
        await settings(page, 1, 'Winner');
    });
    assert.deepEqual(errors, [], 'Gameplay should not produce JavaScript errors');
    await context.close();
}

async function verifyOffline(browser, origin, prefix) {
    const context = await browser.newContext({ viewport: { width: 414, height: 896 }, hasTouch: true, isMobile: true });
    let page = await context.newPage();
    const address = origin + prefix;
    const errors = [];
    context.on('page', current => current.on('pageerror', error => errors.push(error.message)));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(address, { waitUntil: 'load' });
    await check(`${prefix} manifest and images resolve inside the deployment path`, async () => {
        const resources = await page.evaluate(async () => {
            const manifestURL = document.querySelector('link[rel="manifest"]').href;
            const response = await fetch(manifestURL);
            const manifest = await response.json();
            const urls = Array.from(document.querySelectorAll('link[rel*="icon"], link[rel="stylesheet"], script[src], img'), node => node.href || node.src);
            urls.push(manifestURL);
            for (const icon of manifest.icons) urls.push(new URL(icon.src, manifestURL).href);
            const statuses = await Promise.all(urls.map(async url => ({ url, status: (await fetch(url)).status })));
            return { statuses, start: new URL(manifest.start_url || '.', manifestURL).href };
        });
        for (const resource of resources.statuses) {
            assert.ok(resource.url.startsWith(address), `${resource.url} should remain under ${address}`);
            assert.equal(resource.status, 200, `${resource.url} should load`);
        }
        assert.ok(resources.start.startsWith(address), 'Install start URL uses the deployment directory');
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Registration ready alone does not prove the complete offline cache exists;
    // reloading and checking every visible image also exercises the installed worker.
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => Array.from(document.images).every(image => image.complete && image.naturalWidth > 0));

    await check(`${prefix} cached startup does not wait for a slow network`, async () => {
        delayNetwork = true;
        try {
            const start = performance.now();
            await page.reload({ waitUntil: 'load', timeout: 2500 });
            await settings(page, 1, 'Winner');
            const duration = performance.now() - start;
            assert.ok(duration < 2500, 'Cached page and assets should open before the 4-second network response');
            console.log(`  ${prefix} cached load: ${Math.round(duration)} ms with network responses delayed 4000 ms`);
        } finally {
            delayNetwork = false;
        }
    });
    await check(`${prefix} a closed app reopens and works offline`, async () => {
        await context.setOffline(true);
        await page.close();
        page = await context.newPage();
        await page.goto(address, { waitUntil: 'load', timeout: 2500 });
        await page.waitForFunction(() => Array.from(document.images).every(image => image.complete && image.naturalWidth > 0));
        await settings(page, 1, 'Winner');
        await page.locator('#up-arrow').click();
        await settings(page, 2, 'Winners');
        const session = await context.newCDPSession(page);
        await releaseRound(page, session);
        await settings(page, 2, 'Winners');
        await changeMode(page, 'wheel');
        assert.equal(await page.locator('#winner-selector-container').isHidden(), true);
        await touch(session, 'touchStart', twoPoints);
        await page.locator('.finger-circle.chosen').waitFor({ state: 'attached', timeout: 7500 });
        await touch(session, 'touchEnd');
    });
    assert.deepEqual(errors, [], `${prefix} should not produce JavaScript errors`);
    await context.close();
}

async function verifyWheelBlur(browser, address) {
    const context = await browser.newContext({ viewport: { width: 414, height: 896 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    try {
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(address);
        await changeMode(page, 'wheel');
        for (const phase of ['charge', 'spin']) {
            await touch(session, 'touchStart', fourPoints);
            if (phase === 'spin') {
                await page.waitForFunction(() => {
                    const wheel = document.getElementById('wheel-graphic');
                    return wheel.style.transform && wheel.style.transform !== 'rotate(0deg)';
                }, null, { timeout: 4500 });
            }
            const focusPreserved = await page.evaluate(() => {
                const focused = document.activeElement;
                window.dispatchEvent(new Event('blur'));
                return document.activeElement === focused;
            });
            await touch(session, 'touchEnd');
            await page.waitForTimeout(2800);
            assert.equal(await page.locator('.finger-circle').count(), 0, `Blur during ${phase} clears the old contacts`);
            assert.equal(await page.locator('#game-container').evaluate(game => game.style.background), '', `Blur during ${phase} cannot reveal a late winner`);
            assert.equal(await page.locator('#wheel-graphic').evaluate(wheel => wheel.style.transform), 'rotate(0deg)');
            assert.equal(focusPreserved, true, 'Canceling a wheel round does not steal focus');
        }
        assert.deepEqual(errors, []);
        console.log('PASS wheel window blur cancels both charge and spin without late results or focus changes');
    } finally { await context.close(); }
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await playwright.chromium.launch({ executablePath: chromePath, headless: true });
        if (!process.env.PICKY_BLUR_ONLY) {
            await verifyGameplay(browser, origin + '/');
            await verifyOffline(browser, origin, '/');
            await verifyOffline(browser, origin, '/Picky/');
        }
        await verifyWheelBlur(browser, origin + '/');
        console.log('All gameplay and offline browser regressions passed.');
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
