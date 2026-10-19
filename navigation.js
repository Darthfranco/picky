(function (root) {
    'use strict';

    const STORAGE_KEY = 'picky.preferences.v1';
    const MODES = Object.freeze([
        { id: 'finger', name: 'Finger', icon: 'finger' },
        { id: 'wheel', name: 'Wheel', icon: 'wheel' },
        { id: 'four-way', name: '4-Way', icon: 'four-way' },
        { id: 'dice', name: 'Dice', icon: 'dice' },
        { id: 'number', name: '1–100', icon: 'number' },
        { id: 'multi-dice', name: 'Multi Dice', icon: 'multi-dice' },
        { id: 'group', name: 'Finger 5+', icon: 'group' },
        { id: 'teams', name: 'Teams', icon: 'teams' },
        { id: 'teams-group', name: 'Teams 5+', icon: 'teams-group' },
        { id: 'ranking', name: 'Ranking', icon: 'ranking' },
        { id: 'tournament-group', name: 'Tournament 5+', icon: 'tournament-group' }
    ]);
    const MODE_IDS = new Set(MODES.map(mode => mode.id));
    const ICON_PATHS = {
        finger: ['M9 12V5a2 2 0 0 1 4 0v6', 'M13 9a2 2 0 0 1 4 0v3a2 2 0 0 1 4 0v4a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-3L3 12a2 2 0 0 1 3-2l3 3'],
        wheel: ['M12 2a10 10 0 1 0 10 10', 'M12 2v10l7 7', 'M12 12H2', 'M16 2h6v6Z'],
        'four-way': ['M12 3v18M3 12h18', 'M5 5h2M17 5h2M5 19h2M17 19h2'],
        dice: ['M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z', 'M7 7h.01M12 12h.01M17 17h.01'],
        number: ['M9 3 6 21M18 3l-3 18M3 9h18M2 15h18'],
        'multi-dice': ['M9 3h9a3 3 0 0 1 3 3v9', 'M5 8h9a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z', 'M7 12h.01M13 17h.01'],
        group: ['M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM16 4a3 3 0 0 1 0 6', 'M2 21v-3a6 6 0 0 1 12 0v3M17 14v6M14 17h6'],
        teams: ['M5 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM19 14a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z', 'm7 9 10 6M16 3h5v5M3 16v5h5'],
        'teams-group': ['M5 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM16 13a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z', 'm7 8 7 6M18 2v6M15 5h6M3 16v5h5'],
        ranking: ['M3 20h5V11H3ZM9.5 20h5V4h-5ZM16 20h5v-6h-5'],
        'tournament-group': ['M3 3h5v6H3M3 15h5v6H3M8 6h5v12H8M13 12h7', 'M19 2v6M16 5h6'],
        settings: ['M4 6h16M4 12h16M4 18h16', 'M8 3v6M16 9v6M10 15v6'],
        close: ['m6 6 12 12M18 6 6 18'],
        back: ['M19 12H5m7-7-7 7 7 7'],
        check: ['m5 12 4 4L19 6'],
        plus: ['M12 5v14M5 12h14'],
        more: ['M4 7h16M4 12h16M4 17h16']
    };

    function normalizePreferences(value) {
        const prefs = value && typeof value === 'object' ? value : {};
        const pinned = Array.isArray(prefs.pinned)
            ? [...new Set(prefs.pinned.filter(id => MODE_IDS.has(id)))].slice(0, 3)
            : ['finger', 'wheel'];
        return { theme: prefs.theme === 'light' ? 'light' : 'dark', pinned };
    }

    function readPreferences() {
        try {
            return normalizePreferences(JSON.parse(root.localStorage.getItem(STORAGE_KEY)));
        } catch (_) {
            return normalizePreferences(null);
        }
    }

    function init(callbacks = {}) {
        const document = root.document;
        const nav = document.getElementById('game-mode-switcher');
        const menu = document.getElementById('menu-screen');
        if (!nav || !menu) throw new Error('Picky navigation needs its navigation and menu anchors.');
        const prefs = readPreferences();
        let mode = 'finger';
        let busy = false;
        let open = false;
        let popupOpen = false;
        let page = 'modes';
        let returnFocus = null;
        let inertElements = [];

        function persist() {
            try { root.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (_) { /* Memory preferences still work. */ }
        }

        function el(tag, className, text) {
            const element = document.createElement(tag);
            if (className) element.className = className;
            if (text !== undefined) element.textContent = text;
            return element;
        }

        function button(className, text, action) {
            const result = el('button', className, text);
            result.type = 'button';
            result.addEventListener('click', action);
            return result;
        }

        function icon(name) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'mode-icon');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '1.7');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.setAttribute('aria-hidden', 'true');
            for (const data of ICON_PATHS[name]) {
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', data);
                svg.append(path);
            }
            return svg;
        }

        function applyTheme() {
            document.documentElement.dataset.theme = prefs.theme;
            callbacks.onThemeChange?.(prefs.theme);
        }

        function renderNav() {
            nav.replaceChildren();
            const current = MODES.find(item => item.id === mode);
            const switcher = button('mode-switcher', undefined, () => togglePopup());
            switcher.dataset.mode = mode;
            switcher.append(icon(current.icon), el('span', '', current.name));
            switcher.setAttribute('aria-haspopup', 'menu');
            switcher.setAttribute('aria-controls', 'mode-popup');
            switcher.setAttribute('aria-expanded', String(popupOpen));
            switcher.disabled = busy;
            const popup = el('div', 'mode-popup');
            popup.id = 'mode-popup';
            popup.setAttribute('role', 'menu');
            popup.setAttribute('aria-label', 'Pinned modes');
            popup.hidden = !popupOpen;
            for (const id of prefs.pinned.filter(id => id !== mode)) {
                const item = MODES.find(entry => entry.id === id);
                const tab = button('mode-tab', undefined, () => selectMode(id));
                tab.dataset.mode = id;
                tab.append(icon(item.icon), el('span', '', item.name));
                tab.setAttribute('role', 'menuitem');
                tab.disabled = busy;
                popup.append(tab);
            }
            const more = button('mode-tab more-tab', undefined, showModes);
            more.append(icon('more'), el('span', '', 'More'));
            more.setAttribute('role', 'menuitem');
            more.setAttribute('aria-haspopup', 'dialog');
            more.setAttribute('aria-controls', 'menu-screen');
            more.setAttribute('aria-expanded', String(open));
            more.disabled = busy;
            popup.append(more);
            nav.append(switcher, popup);
        }

        function togglePopup() {
            if (busy || open) return;
            popupOpen = !popupOpen;
            renderNav();
            (popupOpen ? nav.querySelector('.mode-tab') : nav.querySelector('.mode-switcher'))?.focus({ preventScroll: true });
        }

        function closePopup(restoreFocus = true) {
            if (!popupOpen) return;
            popupOpen = false;
            renderNav();
            if (restoreFocus) nav.querySelector('.mode-switcher')?.focus({ preventScroll: true });
        }

        function selectMode(id) {
            if (busy || !MODE_IDS.has(id)) return;
            const changed = id !== mode;
            mode = id;
            popupOpen = false;
            close(false);
            renderNav();
            if (changed) callbacks.onModeChange?.(id);
            nav.querySelector('.mode-switcher').focus({ preventScroll: true });
        }

        function renderMenu(focusTarget) {
            const previousPage = menu.dataset.page;
            const previousScroll = menu.scrollTop;
            menu.dataset.page = page;
            const panel = el('div', 'menu-panel');
            const header = el('div', 'menu-header');
            const heading = el('h1', '', page === 'settings' ? 'Settings' : 'Modes');
            heading.id = 'menu-title';
            const back = button('menu-close', undefined, () => {
                if (page === 'settings') { page = 'modes'; renderMenu('.settings-link'); }
                else close();
            });
            back.append(icon(page === 'settings' ? 'back' : 'close'));
            back.setAttribute('aria-label', page === 'settings' ? 'Back to modes' : 'Close menu');
            if (page === 'settings') header.append(back, heading);
            else header.append(heading, back);
            panel.append(header);

            if (page === 'modes') {
                const list = el('div', 'mode-list');
                for (const item of MODES) {
                    const row = button('mode-row', undefined, () => selectMode(item.id));
                    row.dataset.mode = item.id;
                    row.classList.toggle('is-active', mode === item.id);
                    row.setAttribute('aria-pressed', String(mode === item.id));
                    row.append(icon(item.icon), el('span', 'mode-name', item.name));
                    list.append(row);
                }
                const settings = button('settings-link', undefined, () => { page = 'settings'; renderMenu(); });
                settings.append(icon('settings'), el('span', '', 'Settings'));
                panel.append(list, settings);
            } else {
                const appearance = el('section', 'settings-section appearance-section');
                const appearanceTitle = el('h2', 'settings-heading', 'Appearance');
                appearanceTitle.id = 'appearance-title';
                const themes = el('div', 'theme-options');
                themes.setAttribute('role', 'group');
                themes.setAttribute('aria-labelledby', 'appearance-title');
                for (const theme of ['dark', 'light']) {
                    const option = button('theme-option', theme === 'dark' ? 'Dark' : 'Light', () => {
                        prefs.theme = theme;
                        persist();
                        applyTheme();
                        renderMenu(`[data-theme="${theme}"]`);
                    });
                    option.dataset.theme = theme;
                    option.classList.toggle('is-active', prefs.theme === theme);
                    option.setAttribute('aria-pressed', String(prefs.theme === theme));
                    themes.append(option);
                }
                appearance.append(appearanceTitle, themes);
                const pins = el('section', 'settings-section');
                const pinsHeader = el('div', 'settings-section-header');
                pinsHeader.append(el('h2', 'settings-heading', 'Pinned modes'), el('span', 'pin-count', `${prefs.pinned.length} / 3`));
                const note = el('p', 'settings-note', 'Pin up to 3 for quick access.');
                note.id = 'pin-instructions';
                const list = el('div', 'pin-list');
                list.setAttribute('aria-describedby', 'pin-instructions');
                for (const item of MODES) {
                    const pinned = prefs.pinned.includes(item.id);
                    const row = button('pin-row', undefined, () => {
                        if (pinned) prefs.pinned = prefs.pinned.filter(id => id !== item.id);
                        else if (prefs.pinned.length < 3) prefs.pinned.push(item.id);
                        else return;
                        persist();
                        renderNav();
                        renderMenu(`.pin-row[data-mode="${item.id}"]`);
                    });
                    row.dataset.mode = item.id;
                    row.classList.toggle('is-pinned', pinned);
                    row.setAttribute('aria-pressed', String(pinned));
                    row.disabled = !pinned && prefs.pinned.length === 3;
                    const indicator = el('span', 'pin-indicator');
                    indicator.append(icon(pinned ? 'check' : 'plus'));
                    indicator.setAttribute('aria-hidden', 'true');
                    row.append(icon(item.icon), el('span', 'mode-name', item.name), indicator);
                    list.append(row);
                }
                const status = el('p', 'pin-status visually-hidden', `${prefs.pinned.length} of 3 modes pinned`);
                status.setAttribute('role', 'status');
                pins.append(pinsHeader, note, list, status);
                panel.append(appearance, pins);
            }
            menu.replaceChildren(panel);
            menu.scrollTop = previousPage === page ? previousScroll : 0;
            (focusTarget && menu.querySelector(focusTarget) || menu.querySelector('.menu-close')).focus({ preventScroll: true });
        }

        function showModes() {
            if (busy) return;
            popupOpen = false;
            returnFocus = nav.querySelector('.mode-switcher');
            open = true;
            page = 'modes';
            delete menu.dataset.page;
            menu.hidden = false;
            document.body.classList.add('menu-open');
            // Make all app content outside the modal unavailable to keyboard and assistive tech.
            // The menu is a direct sibling of the game's main element in Picky's shell.
            inertElements = [...menu.parentElement.children]
                .filter(element => element !== menu && !['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName))
                .map(element => [element, element.inert]);
            for (const [element] of inertElements) element.inert = true;
            renderNav();
            renderMenu();
            callbacks.onOverlayChange?.(true);
        }

        function close(restoreFocus = true) {
            closePopup(restoreFocus);
            if (!open) return;
            open = false;
            menu.hidden = true;
            document.body.classList.remove('menu-open');
            for (const [element, wasInert] of inertElements) element.inert = wasInert;
            inertElements = [];
            renderNav();
            callbacks.onOverlayChange?.(false);
            if (restoreFocus) {
                const target = returnFocus?.isConnected ? returnFocus : nav.querySelector('.mode-switcher');
                target?.focus({ preventScroll: true });
            }
            returnFocus = null;
        }

        function keydown(event) {
            if (!open && !busy && nav.contains(document.activeElement)) {
                if (event.key === 'Escape' && popupOpen) {
                    event.preventDefault(); event.stopPropagation(); closePopup();
                    return;
                }
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    if (!popupOpen) { popupOpen = true; renderNav(); }
                    const items = [...nav.querySelectorAll('.mode-tab')];
                    const currentIndex = items.indexOf(document.activeElement);
                    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                        : event.key === 'ArrowDown' ? (currentIndex + 1) % items.length
                        : currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
                    items[nextIndex]?.focus();
                    return;
                }
                if (event.key === 'Tab' && popupOpen) closePopup();
            }
            if (!open) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (page === 'settings') { page = 'modes'; renderMenu('.settings-link'); }
                else close();
            } else if (event.key === 'Tab') {
                const controls = [...menu.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && (document.activeElement === first || !menu.contains(document.activeElement))) {
                    event.preventDefault(); last?.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !menu.contains(document.activeElement))) {
                    event.preventDefault(); first?.focus();
                }
            }
        }

        function stopPointer(event) { event.stopPropagation(); }
        function outsidePointer(event) {
            if (popupOpen && !nav.contains(event.target)) {
                event.preventDefault(); event.stopPropagation(); closePopup(false);
            }
        }
        nav.addEventListener('pointerdown', stopPointer);
        menu.addEventListener('pointerdown', stopPointer);
        document.addEventListener('pointerdown', outsidePointer, true);
        document.addEventListener('keydown', keydown);
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-modal', 'true');
        menu.setAttribute('aria-labelledby', 'menu-title');
        menu.tabIndex = -1;
        menu.hidden = true;
        applyTheme();
        renderNav();

        return {
            setMode(id) {
                if (!MODE_IDS.has(id)) return;
                mode = id;
                popupOpen = false;
                renderNav();
                if (open && page === 'modes') renderMenu();
            },
            setBusy(value) {
                if (busy === Boolean(value)) return;
                busy = Boolean(value);
                if (busy) popupOpen = false;
                nav.classList.toggle('is-busy', busy);
                renderNav();
            },
            close,
            getTheme() { return prefs.theme; },
            destroy() {
                close(false);
                nav.removeEventListener('pointerdown', stopPointer);
                menu.removeEventListener('pointerdown', stopPointer);
                document.removeEventListener('pointerdown', outsidePointer, true);
                document.removeEventListener('keydown', keydown);
                nav.replaceChildren();
                menu.replaceChildren();
            }
        };
    }

    const api = Object.freeze({ init, modes: MODES, normalizePreferences });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PickyNavigation = api;
})(typeof window !== 'undefined' ? window : globalThis);
