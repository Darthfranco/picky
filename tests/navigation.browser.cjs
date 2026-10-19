#!/usr/bin/env node
// Exercises popup navigation, menus, settings and storage in a real browser.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) {
    ({ chromium } = require(path.join(process.env.HOME,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')));
}

const shell = '<!doctype html><html><body><main id="game-container"><button class="visually-hidden" id="game-action">Game</button></main><nav id="game-mode-switcher" aria-label="Game modes"></nav><section id="menu-screen" hidden></section></body></html>';

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.route('http://picky.test/**', route => route.fulfill({ contentType: 'text/html', body: shell }));
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const review = path.resolve(__dirname, '../.impeccable/review');
        fs.mkdirSync(review, { recursive: true });
        async function boot(beforeInit, value) {
            await page.goto('http://picky.test/');
            if (beforeInit) await page.evaluate(beforeInit, value);
            await page.addStyleTag({ path: path.resolve(__dirname, '../styles.css') });
            await page.addScriptTag({ path: path.resolve(__dirname, '../navigation.js') });
            await page.evaluate(() => {
                window.events = [];
                window.navigationUI = PickyNavigation.init({
                    onModeChange: value => events.push(['mode', value]),
                    onThemeChange: value => events.push(['theme', value]),
                    onOverlayChange: value => events.push(['overlay', value])
                });
            });
        }
        async function showModes() {
            await page.locator('.mode-switcher').click();
            await page.locator('.more-tab').click();
        }
        const focused = selector => page.locator(selector).evaluate(node => node === document.activeElement);
        await boot();
        assert.equal(await page.locator('.mode-switcher').textContent(), 'Finger');
        assert.equal(await page.locator('#mode-popup').isHidden(), true);
        assert.deepEqual(await page.locator('.mode-tab').allTextContents(), ['Wheel', 'More']);
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
        await page.locator('.mode-switcher').dispatchEvent('pointerdown');
        assert.equal(await page.locator('#mode-popup').isHidden(), true, 'Pointerdown alone must not open the popup');
        await page.locator('.mode-switcher').click();
        assert.equal(await page.locator('#mode-popup').isVisible(), true);
        assert.equal(await page.locator('.mode-switcher').getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('ArrowDown');
        assert.equal(await focused('.more-tab'), true);
        await page.keyboard.press('Home');
        assert.equal(await focused('.mode-tab[data-mode="wheel"]'), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#mode-popup').isHidden(), true);
        assert.equal(await focused('.mode-switcher'), true);
        await page.keyboard.press('ArrowUp');
        assert.equal(await focused('.more-tab'), true);
        await page.keyboard.press('Escape');
        await page.locator('.mode-switcher').click();
        await page.locator('#game-container').click({ position: { x: 15, y: 100 } });
        assert.equal(await page.locator('#mode-popup').isHidden(), true, 'Outside press dismisses the popup');
        await showModes();
        assert.equal(await page.locator('.mode-row').count(), 11);
        assert.equal(await page.locator('#game-container').evaluate(node => node.inert), true);
        assert.equal(await page.locator('#game-mode-switcher').evaluate(node => node.inert), true);
        await page.locator('.settings-link').focus();
        await page.keyboard.press('Tab');
        assert.equal(await focused('.menu-close'), true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused('.settings-link'), true);
        await page.locator('.settings-link').click();
        await page.locator('.theme-option[data-theme="light"]').click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        await page.locator('.pin-row[data-mode="dice"]').click();
        assert.equal(await page.locator('.pin-row:disabled').count(), 8);
        assert.equal(await page.locator('.pin-count').textContent(), '3 / 3');
        await page.locator('.pin-row[data-mode="finger"]').click();
        await page.locator('.pin-row[data-mode="group"]').click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#menu-title').textContent(), 'Modes');
        await page.locator('.mode-row[data-mode="number"]').click();
        assert.equal(await page.locator('#menu-screen').isHidden(), true);
        assert.equal(await page.locator('#game-container').evaluate(node => node.inert), false);
        assert.equal(await focused('.mode-switcher'), true);
        assert.equal(await page.locator('.mode-switcher').textContent(), '1–100');
        assert.deepEqual(await page.evaluate(() => events.filter(event => event[0] === 'mode')), [['mode', 'number']]);
        await boot();
        assert.deepEqual(await page.locator('.mode-tab').allTextContents(), ['Wheel', 'Dice', 'Finger 5+', 'More']);
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        await page.locator('.mode-switcher').click();
        await page.evaluate(() => navigationUI.setBusy(true));
        assert.equal(await page.locator('.mode-switcher:disabled').count(), 1);
        assert.equal(await page.locator('#mode-popup').isHidden(), true);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('#game-mode-switcher')).visibility === 'hidden');
        assert.equal(await page.locator('#game-mode-switcher').evaluate(node => getComputedStyle(node).visibility), 'hidden');
        await page.evaluate(() => navigationUI.setBusy(false));
        await showModes();
        await page.keyboard.press('Escape');
        assert.equal(await focused('.mode-switcher'), true);
        console.log('PASS single mode pill, popup keyboard/outside dismissal, modal focus, selections, pin limit, theme, and persistence');

        await boot(() => localStorage.setItem('picky.preferences.v1', '{broken'));
        assert.deepEqual(await page.locator('.mode-tab').allTextContents(), ['Wheel', 'More']);
        await boot(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } }));
        await showModes();
        await page.locator('.settings-link').click();
        await page.locator('.theme-option[data-theme="light"]').click();
        await page.locator('.pin-row[data-mode="dice"]').click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        assert.equal(await page.locator('.pin-count').textContent(), '3 / 3');
        assert.deepEqual(errors, []);
        console.log('PASS corrupt and blocked storage still allow theme changes and pinning');

        for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
            await page.setViewportSize(viewport);
            for (const theme of ['dark', 'light']) {
                await boot(value => localStorage.setItem('picky.preferences.v1', JSON.stringify({
                    theme: value, pinned: ['multi-dice', 'group', 'tournament-group']
                })), theme);
                await page.evaluate(() => navigationUI.setMode('tournament-group'));
                const bar = await page.locator('.mode-switcher').boundingBox();
                assert.ok(bar.x >= 0 && bar.x + bar.width <= viewport.width, 'Long current mode stays inside the screen');
                await page.locator('.mode-switcher').click();
                const popup = await page.locator('#mode-popup').boundingBox();
                assert.ok(popup.x >= 0 && popup.x + popup.width <= viewport.width && popup.y >= 0, 'Popup stays inside the screen');
                assert.deepEqual(await page.locator('.mode-tab').allTextContents(), ['Multi Dice', 'Finger 5+', 'More']);
                if (viewport.width === 390) await page.screenshot({ path: path.join(review, `navigation-popup-${theme}-390.png`) });
                await page.locator('.more-tab').click();
                assert.equal(await page.locator('.mode-list').evaluate(list => getComputedStyle(list).flexDirection), 'column');
                if (viewport.width === 390) await page.screenshot({ path: path.join(review, `navigation-modes-${theme}-390.png`) });
                for (const id of ['teams', 'teams-group', 'ranking', 'tournament-group']) {
                    await page.locator(`.mode-row[data-mode="${id}"]`).click();
                    assert.equal(await page.locator('.mode-switcher').getAttribute('data-mode'), id);
                    await showModes();
                }
                await page.locator('.settings-link').click();
                assert.equal(await page.locator('.pin-row').count(), 11);
                assert.equal(await page.locator('#menu-screen').evaluate(menu => menu.scrollTop), 0);
                assert.equal(await page.locator('.pin-list').evaluate(list => getComputedStyle(list).gridTemplateColumns.split(' ').length), 2);
                if (viewport.width === 390 || viewport.width === 320 || viewport.width === 844) await page.screenshot({ path: path.join(review, `navigation-settings-${theme}-${viewport.width}.png`) });
                assert.equal(await page.locator('#menu-screen').evaluate(menu => menu.scrollWidth <= menu.clientWidth), true);
                const overflow = await page.locator('.pin-row').evaluateAll(rows => rows.some(row => row.scrollWidth > row.clientWidth));
                assert.equal(overflow, false, 'Every pin card fits its label and icons');
                await page.locator('.pin-row[data-mode="tournament-group"]').click();
                const before = await page.locator('#menu-screen').evaluate(menu => menu.scrollTop);
                await page.locator('.pin-row[data-mode="tournament-group"]').click();
                assert.equal(await page.locator('#menu-screen').evaluate(menu => menu.scrollTop), before, 'Pinning preserves current scroll position');
                const close = await page.locator('.menu-close').boundingBox();
                assert.ok(close.y >= 0 && close.y + close.height <= viewport.height, 'Back remains reachable after scrolling');
                await page.locator('.menu-close').click();
                assert.equal(await page.locator('#menu-title').textContent(), 'Modes');
                assert.equal(await page.locator('#menu-screen').evaluate(menu => menu.scrollTop), 0);
            }
        }
        assert.deepEqual(errors, []);
        console.log('PASS centered scrolling modes, compact two-column settings, all 11 modes, both themes, and phone/landscape/desktop layouts');
        await context.close();
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
