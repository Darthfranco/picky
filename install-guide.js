(function (root) {
    'use strict';

    const document = root.document;
    const displayModes = ['standalone', 'fullscreen', 'minimal-ui'].map(mode => root.matchMedia(`(display-mode: ${mode})`));
    let controller = null;
    let deferredPrompt = null;
    let installedThisVisit = false;

    function platform() {
        const navigator = root.navigator;
        const ua = navigator.userAgent || '';
        if (/iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) || navigator.platform === 'MacIntel') && navigator.maxTouchPoints > 1) return 'ios';
        if (/Android/i.test(ua) || navigator.userAgentData?.platform === 'Android') return 'android';
        return null;
    }

    function standalone() {
        return root.navigator.standalone === true || displayModes.some(query => query.matches);
    }

    // Capture the browser's one-use invitation before the walkthrough is built.
    root.addEventListener('beforeinstallprompt', event => {
        if (platform() !== 'android' || standalone()) return;
        event.preventDefault();
        deferredPrompt = event;
        controller?.updatePrompt();
    });
    root.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        installedThisVisit = true;
        controller?.installed();
    });

    function init() {
        if (controller) return controller;
        if (!document.body) return null;
        const device = platform();
        if (!device) return null;

        const guide = document.createElement('section');
        guide.id = 'install-guide';
        guide.dataset.platform = device;
        guide.hidden = true;
        guide.inert = true;
        guide.tabIndex = -1;
        guide.setAttribute('role', 'dialog');
        guide.setAttribute('aria-modal', 'true');
        guide.setAttribute('aria-labelledby', 'install-title');
        guide.innerHTML = `
            <div class="install-content">
                <div class="install-brand" aria-hidden="true">
                    <img class="install-logo-dark" src="./PickyNB.png" alt="" draggable="false">
                    <img class="install-logo-light" src="./images/picky-toon.png" alt="" draggable="false">
                </div>
                <h1 id="install-title">Add Picky to your Home Screen</h1>
                <p id="install-browser-note" hidden></p>
                <ol class="install-steps" id="install-steps"></ol>
                <button id="install-button" type="button" hidden>Install Picky</button>
                <p id="install-status" role="status" aria-live="polite" hidden></p>
            </div>
            <div class="install-footer"><button id="install-try-browser" type="button">Try in browser</button></div>`;
        document.body.append(guide);
        const $ = id => guide.querySelector(`#${id}`);
        const inAppBrowser = /FBAN|FBAV|Instagram|\bLine\/|Twitter|TikTok|MicroMessenger/i.test(root.navigator.userAgent || '');
        const steps = device === 'ios' ? [
            ['Open Share', 'Tap your browser’s Share button. In Safari’s compact layout, open the page menu first.'],
            ['Add to Home Screen', 'Scroll through the share actions to find it.'],
            ['Add Picky', 'Turn on Open as Web App if shown, then tap Add.']
        ] : [
            ['Open Chrome’s menu', 'Tap the three dots beside the address bar.'],
            ['Choose Install', 'Tap Install and create shortcut, then Install. Older versions may say Add to Home screen.'],
            ['Open Picky', 'Finish the prompts, then launch Picky from your Home Screen.']
        ];
        for (const [index, [title, description]] of steps.entries()) {
            const item = document.createElement('li');
            const heading = document.createElement('h2');
            heading.textContent = title;
            if (index === 0) {
                const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                icon.setAttribute('class', 'install-control-icon');
                icon.setAttribute('viewBox', '0 0 24 24');
                icon.setAttribute('aria-hidden', 'true');
                icon.setAttribute('focusable', 'false');
                icon.innerHTML = device === 'ios'
                    ? '<path d="M12 15V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'
                    : '<circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/>';
                heading.append(icon);
            }
            const text = document.createElement('p');
            text.textContent = description;
            item.append(heading, text);
            $('install-steps').append(item);
        }
        if (inAppBrowser) {
            $('install-browser-note').hidden = false;
            $('install-browser-note').textContent = `Open this page in ${device === 'ios' ? 'Safari' : 'Chrome'} to add Picky.`;
        }

        let open = false;
        let prompting = false;
        let accepted = false;
        let previousFocus = null;
        let wasHidden = document.visibilityState === 'hidden';
        const priorInert = new Map();
        const ignored = new Set(['SCRIPT', 'STYLE', 'LINK']);

        function protectApp() {
            if (!open) return;
            for (const element of document.body.children) {
                if (element === guide || ignored.has(element.tagName)) continue;
                if (!priorInert.has(element)) priorInert.set(element, element.inert);
                if (!element.inert) element.inert = true;
            }
            // Navigation also protects sibling surfaces when its menu is open.
            // The active installation guide must remain the interactive surface.
            if (guide.inert) guide.inert = false;
        }

        const inertObserver = new MutationObserver(records => {
            if (!open) return;
            for (const record of records) {
                if (record.type === 'attributes' && record.attributeName === 'inert' && priorInert.has(record.target) && !record.target.inert) {
                    // A menu may close during a visibility change. Remember its
                    // new intent, then keep the guide's temporary lock in place.
                    priorInert.set(record.target, false);
                }
            }
            protectApp();
        });

        function status(text) {
            $('install-status').textContent = text;
            $('install-status').hidden = !text;
        }

        function updatePrompt() {
            if (deferredPrompt && !prompting) { accepted = false; status(''); }
            $('install-button').hidden = device !== 'android' || !deferredPrompt || installedThisVisit;
            $('install-button').disabled = prompting;
            $('install-button').textContent = prompting ? 'Opening install…' : 'Install Picky';
            const nativePath = device === 'android' && Boolean(deferredPrompt || prompting || accepted);
            $('install-steps').hidden = nativePath;
            $('install-browser-note').hidden = !inAppBrowser || nativePath;
        }

        function show(isReturn = false) {
            if (isReturn) installedThisVisit = false;
            if (standalone()) { close(false); return; }
            if (open || installedThisVisit) return;
            previousFocus = document.activeElement;
            accepted = false;
            open = true;
            guide.hidden = false;
            guide.inert = false;
            document.documentElement.classList.add('install-guide-open');
            status('');
            updatePrompt();
            protectApp();
            inertObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
            guide.scrollTop = 0;
            guide.focus({ preventScroll: true });
        }

        function close(restoreFocus = true) {
            if (!open) return;
            open = false;
            inertObserver.disconnect();
            guide.hidden = true;
            guide.inert = true;
            document.documentElement.classList.remove('install-guide-open');
            for (const [element, inert] of priorInert) {
                if (element.isConnected) element.inert = inert;
            }
            priorInert.clear();
            if (restoreFocus) {
                const target = previousFocus?.isConnected && !previousFocus.closest('[inert]') && previousFocus !== document.body
                    ? previousFocus : document.querySelector('#menu-screen:not([hidden]) .menu-close') || document.querySelector('.mode-switcher');
                if (target && !target.closest('[inert]')) target.focus({ preventScroll: true });
            }
            previousFocus = null;
        }

        async function install() {
            if (prompting || !deferredPrompt || standalone()) return;
            const invitation = deferredPrompt;
            // Native invitations cannot be reused after either acceptance or
            // dismissal. A later beforeinstallprompt enables the next attempt.
            deferredPrompt = null;
            prompting = true;
            $('install-button').disabled = true;
            $('install-button').textContent = 'Opening install…';
            status('');
            try {
                const result = await invitation.prompt();
                const choice = invitation.userChoice ? await invitation.userChoice : result;
                if (choice?.outcome === 'accepted') { accepted = true; status('Open Picky from your Home Screen.'); }
                else status('You can still install from Chrome’s menu.');
            } catch (_) {
                status('Use Chrome’s menu to install Picky.');
            } finally {
                prompting = false;
                updatePrompt();
                if (open) {
                    const target = $('install-button').hidden ? $('install-try-browser') : $('install-button');
                    target.focus({ preventScroll: true });
                }
            }
        }

        $('install-button').addEventListener('click', install);
        $('install-try-browser').addEventListener('click', () => close());
        guide.addEventListener('pointerdown', event => event.stopPropagation());
        document.addEventListener('keydown', event => {
            if (!open) return;
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopImmediatePropagation(); close();
            } else if (event.key === 'Tab') {
                const controls = [...guide.querySelectorAll('button:not([hidden]):not(:disabled)')];
                const first = controls[0], last = controls[controls.length - 1];
                if (!guide.contains(document.activeElement) || document.activeElement === guide || event.shiftKey && document.activeElement === first) {
                    event.preventDefault(); (event.shiftKey ? last : first)?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault(); first?.focus();
                }
            }
        }, true);
        root.addEventListener('pageshow', event => { if (event.persisted) show(true); });
        root.addEventListener('pagehide', () => { wasHidden = true; });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') wasHidden = true;
            else if (wasHidden) { wasHidden = false; show(true); }
        });
        for (const query of displayModes) {
            const changed = () => { if (standalone()) close(); else show(true); };
            if (query.addEventListener) query.addEventListener('change', changed);
            else query.addListener?.(changed);
        }
        controller = Object.freeze({
            show,
            close,
            updatePrompt,
            installed() { updatePrompt(); close(); }
        });
        show();
        return controller;
    }

    root.PickyInstall = Object.freeze({ init });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})(window);
