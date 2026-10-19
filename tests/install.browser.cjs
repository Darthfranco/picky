#!/usr/bin/env node
// Mobile installation gate regressions. Chromium emulates the platform UAs;
// native install availability and installed display modes are controlled here.
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
const userAgents = {
    ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
};
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const file = path.resolve(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || 'index.html');
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, body) => {
        res.writeHead(error ? 404 : 200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(error ? 'Not found' : body);
    });
});

async function boot(browser, address, options = {}) {
    const { platform, theme = 'dark', viewport = { width: 390, height: 844 }, installed, touchDesktop = false, ipad = false } = options;
    const context = await browser.newContext({
        viewport,
        ...(platform && !ipad ? { userAgent: userAgents[platform] } : {}),
        hasTouch: Boolean(platform || touchDesktop),
        isMobile: Boolean(platform || touchDesktop),
        serviceWorkers: options.serviceWorkers || 'block'
    });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ theme, installed, ipad }) => {
        localStorage.setItem('picky.preferences.v1', JSON.stringify({ theme, pinned: ['wheel', 'dice', 'group'] }));
        if (installed === 'ios') Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
        if (installed && installed !== 'ios') {
            const originalMatchMedia = window.matchMedia.bind(window);
            window.matchMedia = query => {
                const media = originalMatchMedia(query);
                if (/display-mode\s*:\s*(standalone|fullscreen|minimal-ui)/.test(query)) {
                    Object.defineProperty(media, 'matches', { configurable: true, value: query.includes(installed) });
                }
                return media;
            };
        }
        if (ipad) {
            Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
            Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
        }
    }, { theme, installed, ipad });
    await page.goto(address, { waitUntil: 'load' });
    return { context, page, errors, theme, viewport, platform };
}

async function guideVisible(page, platform) {
    await page.locator('#install-guide').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await page.locator('#install-guide').getAttribute('data-platform'), platform);
    assert.equal(await page.locator('#game-container').evaluate(node => node.inert), true, 'The game is inert behind installation guidance');
    assert.equal(await page.locator('#game-mode-switcher').evaluate(node => node.inert), true, 'Game navigation cannot receive focus behind the guide');
}

async function tryBrowser(page) {
    await page.locator('#install-try-browser').click();
    await page.locator('#install-guide').waitFor({ state: 'hidden', timeout: 2000 });
    assert.equal(await page.locator('#game-container').evaluate(node => node.inert), false);
    assert.equal(await page.locator('#game-mode-switcher').evaluate(node => node.inert), false);
}

async function preferencesUnchanged(page, theme) {
    const storage = await page.evaluate(() => ({
        prefs: JSON.parse(localStorage.getItem('picky.preferences.v1')),
        localKeys: Object.keys(localStorage),
        sessionKeys: Object.keys(sessionStorage)
    }));
    assert.deepEqual(storage.prefs, { theme, pinned: ['wheel', 'dice', 'group'] }, 'Installation guidance does not change appearance or pinned games');
    assert.deepEqual(storage.localKeys, ['picky.preferences.v1'], 'Trying the browser does not save a permanent skip flag');
    assert.deepEqual(storage.sessionKeys, [], 'The guide does not persist a session skip flag');
}

async function returnToPage(page) {
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.hidden;
        delete document.visibilityState;
    });
}

async function screenshot(page, name) {
    fs.mkdirSync(review, { recursive: true });
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: path.join(review, `install-${name}.png`), animations: 'disabled' });
}

async function assertModalInput(page, context) {
    assert.equal(await page.locator('#install-guide').evaluate(guide => guide.contains(document.activeElement)), true, 'Focus starts inside the guide');
    for (let step = 0; step < 5; step++) {
        await page.keyboard.press(step % 2 ? 'Shift+Tab' : 'Tab');
        assert.equal(await page.locator('#install-guide').evaluate(guide => guide.contains(document.activeElement)), true, 'Keyboard navigation stays inside the guide');
    }
    await page.locator('.mode-switcher').evaluate(node => node.focus());
    assert.equal(await page.locator('#install-guide').evaluate(guide => guide.contains(document.activeElement)), true, 'An inert game control cannot take focus');
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: 12, y: 180, radiusX: 8, radiusY: 8, force: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await page.locator('.finger-circle').count(), 0, 'Touches on the guide cannot start the hidden game');
    assert.equal(await page.locator('#game-container').getAttribute('data-mode'), 'finger');
}

async function ios(browser, address, theme) {
    const { context, page, errors } = await boot(browser, address, { platform: 'ios', theme });
    try {
        await guideVisible(page, 'ios');
        assert.equal(await page.evaluate(() => PickyInstall.init() === PickyInstall.init()), true, 'Repeated initialization reuses the guide');
        assert.equal(await page.locator('#install-guide').count(), 1);
        assert.equal(await page.locator('#install-button').isVisible(), false, 'Safari guidance does not promise a native install prompt');
        assert.equal(await page.locator('#install-steps').isVisible(), true, 'Safari shows the manual Home Screen steps');
        assert.match(await page.locator('#install-guide').textContent(), /Home Screen/i);
        await assertModalInput(page, context);
        await screenshot(page, `ios-390-${theme}`);
        await tryBrowser(page);
        await preferencesUnchanged(page, theme);
        await page.locator('.mode-switcher').click();
        await page.locator('#mode-popup .mode-tab[data-mode="wheel"]').click();
        assert.equal(await page.locator('#game-container').getAttribute('data-mode'), 'wheel', 'Try in browser unlocks the actual app');
        assert.equal(await page.locator('#install-guide').isVisible(), false, 'Ordinary play does not reopen the guide');
        if (theme === 'dark') {
            await page.reload({ waitUntil: 'load' });
            await guideVisible(page, 'ios');
            await tryBrowser(page);
            await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
            await guideVisible(page, 'ios');
            await tryBrowser(page);
            await returnToPage(page);
            await guideVisible(page, 'ios');
            await tryBrowser(page);

            await page.locator('#menu-screen').evaluate(node => { node.inert = true; });
            await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
            await guideVisible(page, 'ios');
            await tryBrowser(page);
            assert.equal(await page.locator('#menu-screen').evaluate(node => node.inert), true, 'Closing restores a sibling that was already inert');
            await preferencesUnchanged(page, theme);
        }
        assert.deepEqual(errors, []);
        console.log(`PASS iPhone Safari installation guide, focus, browser entry, and preferences (${theme})`);
    } finally { await context.close(); }
}

async function offerNativeInstall(page) {
    return page.evaluate(() => {
        const event = new Event('beforeinstallprompt', { cancelable: true });
        const offer = { calls: 0, resolve: null };
        const choice = new Promise(resolve => { offer.resolve = resolve; });
        Object.defineProperties(event, {
            prompt: { value: () => { offer.calls++; return choice; } },
            userChoice: { value: choice }
        });
        window.installOffers ??= [];
        const index = window.installOffers.push(offer) - 1;
        window.dispatchEvent(event);
        return { index, prevented: event.defaultPrevented };
    });
}

async function android(browser, address, theme) {
    const { context, page, errors } = await boot(browser, address, { platform: 'android', theme });
    try {
        await guideVisible(page, 'android');
        assert.equal(await page.locator('#install-button').isVisible(), false, 'No native install button appears before the browser offers installation');
        assert.equal(await page.locator('#install-steps').isVisible(), true, 'Manual Android steps are available when there is no native offer');
        const first = await offerNativeInstall(page);
        assert.equal(first.prevented, true, 'The automatic prompt is deferred until the user presses Install');
        await page.locator('#install-button').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#install-steps').isVisible(), false, 'The native Install action replaces redundant manual instructions');
        await screenshot(page, `android-390-${theme}`);
        if (theme === 'dark') {
            await page.locator('#install-button').click();
            await page.waitForFunction(index => window.installOffers[index].calls === 1, first.index);
            await page.locator('#install-button').evaluate(button => button.click());
            assert.equal(await page.evaluate(index => window.installOffers[index].calls, first.index), 1, 'A pending native prompt is invoked only once');
            await page.evaluate(index => window.installOffers[index].resolve({ outcome: 'dismissed', platform: 'web' }), first.index);
            await page.waitForFunction(() => {
                const button = document.getElementById('install-button');
                return button.hidden || button.disabled || getComputedStyle(button).display === 'none';
            });
            await guideVisible(page, 'android');
            assert.equal(await page.locator('#install-steps').isVisible(), true, 'Declining the native prompt restores the manual instructions');
            const retry = await offerNativeInstall(page);
            await page.locator('#install-button').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#install-steps').isVisible(), false, 'A new native offer replaces the manual steps again');
            await page.locator('#install-button').click();
            await page.waitForFunction(index => window.installOffers[index].calls === 1, retry.index);
            await page.evaluate(index => window.installOffers[index].resolve({ outcome: 'accepted', platform: 'web' }), retry.index);
            await page.waitForFunction(() => /Open Picky from your Home Screen/i.test(document.getElementById('install-guide').textContent));
            await guideVisible(page, 'android');
            assert.equal(await page.locator('#install-steps').isVisible(), false, 'Accepted installation keeps only the launch instruction');
            await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
            await page.locator('#install-guide').waitFor({ state: 'hidden' });
            assert.equal(await page.locator('#game-container').evaluate(node => node.inert), false, 'Installation closes the guide and restores the app');
            await returnToPage(page);
            await guideVisible(page, 'android');
            assert.equal(await page.locator('#install-steps').isVisible(), true, 'Returning to the browser after installation restores useful manual guidance');
            assert.equal(await page.locator('#install-button').isVisible(), false, 'A consumed native invitation is not offered again');
        }
        await tryBrowser(page);
        await preferencesUnchanged(page, theme);
        await offerNativeInstall(page);
        assert.equal(await page.locator('#install-guide').isVisible(), false, 'A fresh install offer does not interrupt the current browser visit');
        await page.reload({ waitUntil: 'load' });
        await guideVisible(page, 'android');
        assert.deepEqual(errors, []);
        console.log(`PASS Android native install availability, browser entry, and return (${theme})`);
    } finally { await context.close(); }
}

async function suppressed(browser, address, options, label) {
    const { context, page, errors } = await boot(browser, address, options);
    try {
        assert.equal(await page.locator('#install-guide').isVisible(), false, `${label}: no installation gate`);
        assert.equal(await page.locator('#game-container').evaluate(node => node.inert), false);
        await returnToPage(page);
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        assert.equal(await page.locator('#install-guide').isVisible(), false, `${label}: returning does not show the guide`);
        await page.locator('.mode-switcher').click();
        assert.equal(await page.locator('#mode-popup').isVisible(), true, `${label}: app navigation is immediately usable`);
        assert.deepEqual(errors, []);
        console.log(`PASS ${label} opens directly into the game`);
    } finally { await context.close(); }
}

async function compact(browser, address, platform, viewport, theme) {
    const { context, page, errors } = await boot(browser, address, { platform, viewport, theme });
    try {
        await guideVisible(page, platform);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Installation guidance never creates horizontal overflow');
        await page.locator('#install-try-browser').scrollIntoViewIfNeeded();
        const bounds = await page.locator('#install-try-browser').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, 'The browser-entry action fits the viewport');
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, 'The browser-entry action is reachable on short screens');
        assert.ok(bounds.height >= 44, 'The action has a finger-sized touch target');
        await screenshot(page, `${platform}-${viewport.width}x${viewport.height}-${theme}`);
        await tryBrowser(page);
        assert.deepEqual(errors, []);
        console.log(`PASS responsive install guidance (${platform}, ${viewport.width}×${viewport.height})`);
    } finally { await context.close(); }
}

async function offline(browser, address) {
    const { context, page, errors } = await boot(browser, address, { platform: 'ios', theme: 'light', serviceWorkers: 'allow' });
    try {
        await guideVisible(page, 'ios');
        await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
        await page.evaluate(() => navigator.serviceWorker.ready);
        await context.setOffline(true);
        await page.reload({ waitUntil: 'load', timeout: 3500 });
        await guideVisible(page, 'ios');
        await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
        const assets = await page.evaluate(async () => {
            const manifest = await (await fetch('./manifest.json')).json();
            const required = ['./install-guide.js', './install-guide.css', ...manifest.icons.map(icon => new URL(icon.src, new URL('./manifest.json', location.href)).href)];
            return Promise.all(required.map(async url => ({ url, status: (await fetch(url)).status })));
        });
        assert.ok(assets.every(asset => asset.status === 200), `The guide and installation icons load offline: ${JSON.stringify(assets)}`);
        await tryBrowser(page);
        const session = await context.newCDPSession(page);
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{ id: 0, x: 100, y: 430, radiusX: 10, radiusY: 10, force: 1 }, { id: 1, x: 290, y: 540, radiusX: 10, radiusY: 10, force: 1 }]
        });
        assert.equal(await page.locator('.finger-circle').count(), 2, 'The app accepts players after entering from the offline guide');
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.equal(await page.locator('.finger-circle').count(), 0);
        await preferencesUnchanged(page, 'light');
        assert.deepEqual(errors, []);
        console.log('PASS mobile offline reload includes the guide, installation icons, and usable gameplay');
    } finally { await context.close(); }
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
        const address = `http://127.0.0.1:${server.address().port}/`;
        for (const theme of ['dark', 'light']) await ios(browser, address, theme);
        for (const theme of ['dark', 'light']) await android(browser, address, theme);
        await suppressed(browser, address, { viewport: { width: 1280, height: 800 } }, 'Desktop');
        await suppressed(browser, address, { touchDesktop: true }, 'Touch-enabled desktop UA');
        await suppressed(browser, address, { platform: 'ios', installed: 'ios' }, 'Installed iOS app');
        for (const displayMode of ['standalone', 'fullscreen', 'minimal-ui']) {
            await suppressed(browser, address, { platform: 'android', installed: displayMode }, `Android ${displayMode}`);
        }
        const ipad = await boot(browser, address, { platform: 'ios', ipad: true, viewport: { width: 820, height: 1180 } });
        try { await guideVisible(ipad.page, 'ios'); assert.deepEqual(ipad.errors, []); }
        finally { await ipad.context.close(); }
        await compact(browser, address, 'ios', { width: 320, height: 568 }, 'dark');
        await compact(browser, address, 'android', { width: 844, height: 390 }, 'light');
        await offline(browser, address);
        console.log('All installation guide browser regressions passed.');
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
