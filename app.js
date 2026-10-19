(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const game = $('game-container');
    const START_DELAY = 2400;
    const GROUP_RESULT_DURATION = 2000;
    const ROLL_DURATION = 1300;
    const NUMBER_DURATION = 1000;
    const MAX_NUMBER = 0x100000000;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const modeNames = { finger: 'Finger', wheel: 'Wheel', 'four-way': '4-Way', dice: 'Dice', number: '1–100', 'multi-dice': 'Multi Dice', group: 'Finger 5+', teams: 'Teams', 'teams-group': 'Teams 5+', ranking: 'Ranking', 'tournament-group': 'Tournament 5+' };
    const partyModes = new Set(['teams', 'teams-group', 'ranking', 'tournament-group']);
    const lightColors = ['#F0604E', '#2F9AB1', '#E7AC35', '#9286E4', '#5AA971', '#DD6FA5', '#C37635', '#657BC0', '#AF9335', '#388779'];
    let currentMode = 'finger';
    let theme = 'dark';
    let state = 'waiting';
    let count = 1;
    let sides = 6;
    let selectionMode = 'winner';
    let navigation = null;
    let party = null;
    let tournament = null;
    let partyUI = { busy: false, hideLogo: false, compactLogo: false };
    let overlayOpen = false;
    let session = 0;
    let frame = null;
    let holdId = null;
    let holdKey = null;
    let chargeTimer = null;
    let countHold = null;
    let ignoredCountClick = null;
    let winners = [];
    let pairWinners = [];
    let groupPlayers = [];
    let lastResultColor = null;
    const fingers = new Map();
    const groupPointers = new Set();
    const timers = new Set();
    const dice = PickyDice.create($('dice-canvas'));
    let diceReady = false;
    let diceFailed = false;

    function randomInt(max) {
        // Rejection sampling keeps every outcome equally likely.
        if (!Number.isInteger(max) || max < 1 || max > MAX_NUMBER) throw new RangeError('Invalid random range');
        const limit = Math.floor(MAX_NUMBER / max) * max;
        const value = new Uint32Array(1);
        do { crypto.getRandomValues(value); } while (value[0] >= limit);
        return value[0] % max;
    }

    function sample(items, amount) {
        const pool = [...items];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, amount);
    }

    function later(callback, delay) {
        const version = session;
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (version === session) callback();
        }, delay);
        timers.add(timer);
        return timer;
    }

    function cancelCharge() {
        if (chargeTimer !== null) {
            clearTimeout(chargeTimer);
            timers.delete(chargeTimer);
            chargeTimer = null;
        }
        game.classList.remove('charging', 'pulsing');
    }

    function startCharge(onComplete) {
        cancelCharge();
        // Every mode uses the same three pulses and hold duration.
        void game.offsetWidth;
        game.classList.add('charging');
        chargeTimer = later(() => {
            chargeTimer = null;
            game.classList.remove('charging');
            onComplete();
        }, START_DELAY);
    }

    function isDice() { return currentMode === 'dice' || currentMode === 'multi-dice'; }
    function isHoldMode() { return isDice() || currentMode === 'number'; }
    function isClassic() { return ['finger', 'wheel', 'four-way'].includes(currentMode); }
    function isBusy() { return !['waiting', 'result'].includes(state); }
    function isPartyMode() { return partyModes.has(currentMode); }

    function playerColor(index) {
        if (theme === 'light') return lightColors[index % lightColors.length];
        return PickyColors.palette[index % PickyColors.palette.length];
    }

    function nextFingerColor() {
        const active = [...fingers.values()].map(f => f.color);
        if (theme === 'light') {
            return lightColors.find(color => !active.includes(color)) || lightColors[0];
        }
        return PickyColors.selectColor(sample(PickyColors.palette, PickyColors.palette.length), active);
    }

    function randomResultColor() {
        const pool = (theme === 'light' ? lightColors.slice(0, 5) : PickyColors.palette.slice(0, 5))
            .filter(color => color !== lastResultColor);
        lastResultColor = pool[randomInt(pool.length)];
        return lastResultColor;
    }

    function setResultColor(color) {
        game.style.setProperty('--result-color', color);
        game.style.background = color;
        const rgb = color.slice(1).match(/.{2}/g).map(part => {
            const c = parseInt(part, 16) / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        const lightness = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        game.style.setProperty('--result-ink', lightness > 0.179 ? '#161310' : '#FFF9EE');
    }

    function resetRound({ clearGroup = false } = {}) {
        stopCountHold(true);
        cancelCharge();
        session++;
        timers.forEach(clearTimeout);
        timers.clear();
        cancelAnimationFrame(frame);
        frame = null;
        dice.cancel();
        const releasedId = holdId;
        holdId = null;
        holdKey = null;
        if (typeof releasedId === 'number' && game.hasPointerCapture(releasedId)) game.releasePointerCapture(releasedId);
        groupPointers.clear();
        fingers.forEach(f => f.element.remove());
        fingers.clear();
        winners = [];
        pairWinners = [];
        if (clearGroup) groupPlayers = [];
        state = 'waiting';
        game.classList.remove('pulsing', 'holding', 'playing', 'has-result');
        game.style.background = '';
        game.style.removeProperty('--result-color');
        game.style.removeProperty('--result-ink');
        $('wheel-graphic').style.transition = 'none';
        $('wheel-graphic').style.transform = 'rotate(0deg)';
        $('wheel-graphic').style.background = '';
        $('wheel-area').classList.remove('visible');
        $('number-value').textContent = '0';
        $('number-value').style.setProperty('--number-digits', 1);
        $('result-screen').hidden = true;
        $('result-value').textContent = '';
        render();
        renderGroup();
        showDice();
    }

    function resetSettings() {
        party?.leave();
        tournament?.leave();
        partyUI = { busy: false, hideLogo: false, compactLogo: false };
        count = currentMode === 'number' ? 100 : currentMode === 'multi-dice' ? 2 : currentMode === 'four-way' ? 4 : 1;
        sides = 6;
        selectionMode = 'winner';
        resetRound({ clearGroup: true });
        if (currentMode === 'tournament-group') tournament?.enter(currentMode);
        else if (isPartyMode()) party?.enter(currentMode);
    }

    function switchMode(mode) {
        if (!modeNames[mode] || mode === currentMode) return;
        currentMode = mode;
        game.dataset.mode = mode;
        game.setAttribute('aria-label', `${modeNames[mode]} game`);
        navigation?.setMode(mode);
        resetSettings();
    }

    function setTheme(value) {
        theme = value === 'light' ? 'light' : 'dark';
        document.documentElement.dataset.theme = theme;
        document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#FFF5DF' : '#000000';
        $('picky-logo').src = theme === 'light' ? './images/picky-toon.png' : './PickyNB.png';
        groupPlayers.forEach((player, index) => { player.color = playerColor(index); });
        renderGroup();
        showDice();
        party?.setTheme(theme);
        tournament?.setTheme(theme);
    }

    function showDice() {
        if (isDice() && diceReady && state === 'waiting') {
            dice.show({ sides: currentMode === 'multi-dice' ? 6 : sides, count: currentMode === 'multi-dice' ? count : 1, theme });
        }
    }

    function render() {
        if (isPartyMode()) {
            for (const id of ['winner-selector-container', 'mode-settings', 'dice-stage', 'number-stage', 'hold-hint', 'group-stage', 'group-actions', 'result-screen']) $(id).hidden = true;
            for (const id of ['touch-area-divider', 'divider-vertical', 'divider-horizontal', 'wheel-area']) $(id).classList.remove('visible');
            document.querySelector('.finger-placement-area-label').classList.remove('visible');
            game.classList.remove('playing', 'holding', 'has-result');
            $('start-screen-ui').classList.toggle('compact-brand', partyUI.compactLogo);
            $('start-screen-ui').hidden = partyUI.hideLogo;
            $('start-screen-ui').style.opacity = '1';
            navigation?.setBusy(partyUI.busy);
            return;
        }
        const busy = isBusy();
        const result = state === 'result';
        const topControls = ['finger', 'multi-dice', 'group', 'number'].includes(currentMode);
        game.classList.toggle('playing', busy);
        game.classList.toggle('holding', state === 'holding');
        $('start-screen-ui').classList.toggle('compact-brand', !isClassic());
        $('start-screen-ui').hidden = isClassic() ? fingers.size > 0 : busy || result;
        $('start-screen-ui').style.opacity = fingers.size ? '0' : '1';
        $('winner-selector-container').hidden = !topControls || busy || result;
        $('winner-count').textContent = count;
        $('winner-label').textContent = currentMode === 'number' ? 'Max' : currentMode === 'multi-dice' ? (count === 1 ? 'Die' : 'Dice') : `${selectionMode === 'loser' ? 'Loser' : 'Winner'}${count === 1 ? '' : 's'}`;
        $('reverse-button').hidden = currentMode !== 'finger';
        $('reverse-button').classList.toggle('toggled', selectionMode === 'loser');
        $('reverse-button').setAttribute('aria-pressed', String(selectionMode === 'loser'));
        $('down-arrow').disabled = count <= 1;
        $('up-arrow').disabled = count >= maxCount();
        $('winner-selector-container').setAttribute('aria-label', currentMode === 'number' ? `Pick a number from 1 to ${count}` : 'Game settings');
        for (const [id, label, action] of [['up-arrow', 'Increase', 'add'], ['down-arrow', 'Decrease', 'subtract']]) {
            $(id).setAttribute('aria-label', currentMode === 'number' ? `${label} maximum; hold to ${action} 10` : `${label} count`);
            $(id).title = currentMode === 'number' ? `Hold to ${action} 10` : '';
        }
        $('mode-settings').hidden = currentMode !== 'dice' || busy || result;
        $('dice-options').hidden = currentMode !== 'dice';
        document.querySelectorAll('[data-sides]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.sides) === sides)));
        $('dice-stage').hidden = !isDice() || result;
        $('number-stage').hidden = currentMode !== 'number' || result;
        $('hold-hint').hidden = !isHoldMode() || state !== 'waiting';
        $('hold-hint').textContent = diceFailed && isDice() ? 'Dice unavailable. Reopen to try again.' : !diceReady && isDice() ? 'Getting dice ready…' : currentMode === 'number' ? 'Hold to pick' : 'Hold to roll';
        $('group-stage').hidden = currentMode !== 'group';
        $('group-actions').hidden = currentMode !== 'group' || busy || result;
        $('group-hint').hidden = busy || result;
        const placement = document.querySelector('.finger-placement-area-label');
        const wheelWaiting = currentMode === 'wheel' && state === 'waiting';
        const fourWaiting = currentMode === 'four-way' && state === 'waiting';
        $('touch-area-divider').classList.toggle('visible', wheelWaiting);
        $('divider-vertical').classList.toggle('visible', currentMode === 'four-way' && !result && state !== 'ready');
        $('divider-horizontal').classList.toggle('visible', currentMode === 'four-way' && state === 'waiting');
        placement.classList.toggle('visible', wheelWaiting || fourWaiting);
        placement.textContent = wheelWaiting ? 'Place fingers below' : fourWaiting ? 'One finger in each area' : '';
        navigation?.setBusy(busy || result);
    }

    function renderGroup() {
        const entries = $('group-entries');
        entries.replaceChildren(...groupPlayers.map(player => {
            const entry = document.createElement('span');
            entry.className = 'group-entry';
            entry.textContent = player.number;
            entry.dataset.number = player.number;
            entry.style.setProperty('--player-color', player.color);
            entry.style.left = `${player.x * 100}%`;
            entry.style.top = `${player.y * 100}%`;
            entry.setAttribute('aria-label', `Player ${player.number}`);
            return entry;
        }));
        $('group-hint').textContent = 'Tap once. Remember your number.';
        $('group-undo').disabled = !groupPlayers.length || isBusy();
        $('group-clear').disabled = !groupPlayers.length || isBusy();
        $('group-pick').disabled = groupPlayers.length < 2 || isBusy();
    }

    function addPlayer(clientX, clientY) {
        if (state !== 'waiting' || overlayOpen) return;
        const bounds = game.getBoundingClientRect();
        const number = groupPlayers.length + 1;
        // Keep the center at the original touch, including after release.
        // Fractions preserve the placement when the phone rotates.
        const x = clientX === undefined ? 0.5 : (clientX - bounds.left) / bounds.width;
        const y = clientY === undefined ? 0.5 : (clientY - bounds.top) / bounds.height;
        groupPlayers.push({ number, color: playerColor(number - 1), x, y });
        renderGroup();
        $('group-status').textContent = `You are number ${number}.`;
        const entry = $('group-entries').lastElementChild;
        entry.classList.add('new-player');
    }

    function showResult(value, color = randomResultColor()) {
        state = 'result';
        game.classList.add('has-result');
        setResultColor(color);
        $('result-value').textContent = value;
        $('result-value').style.setProperty('--number-digits', String(value).length);
        $('result-value').classList.toggle('multiple', String(value).length > 4);
        $('result-screen').hidden = false;
        $('result-screen').tabIndex = holdId === 'virtual' ? 0 : -1;
        if (holdId === 'virtual') {
            $('result-screen').setAttribute('role', 'button');
            $('result-screen').setAttribute('aria-label', `${value}. Clear result`);
            $('result-screen').focus({ preventScroll: true });
        } else {
            $('result-screen').removeAttribute('role');
            $('result-screen').removeAttribute('aria-label');
        }
        render();
    }

    function startHold(id) {
        if (state !== 'waiting' || overlayOpen || (isDice() && !diceReady)) return;
        stopCountHold(true);
        state = 'holding';
        holdId = id;
        if (id === 'keyboard') game.focus({ preventScroll: true });
        render();
        startCharge(performRoll);
    }

    function releaseHold(id) {
        if (holdId === null || id !== holdId) return;
        // The initiating contact owns the whole round, including its result.
        // Lifting cancels pending animation and returns to the same settings.
        resetRound();
        if (id === 'keyboard' || id === 'virtual') {
            $(currentMode === 'group' ? 'group-pick' : isDice() ? 'dice-stage' : 'number-stage').focus({ preventScroll: true });
        }
    }

    function performRoll() {
        state = 'rolling';
        render();
        const version = session;
        if (currentMode === 'number') {
            const target = randomInt(count) + 1;
            $('number-value').style.setProperty('--number-digits', String(target).length);
            const begin = performance.now();
            // Animate by elapsed time, never by the size of the chosen number.
            const step = now => {
                if (version !== session || state !== 'rolling') return;
                const progress = Math.min(1, (now - begin) / NUMBER_DURATION);
                const eased = 1 - (1 - progress) ** 3;
                $('number-value').textContent = reducedMotion.matches ? '0' : Math.floor(target * eased);
                if (progress < 1) frame = requestAnimationFrame(step);
                else showResult(String(target));
            };
            frame = requestAnimationFrame(step);
            return;
        }
        const rollSides = currentMode === 'multi-dice' ? 6 : sides;
        const rollCount = currentMode === 'multi-dice' ? count : 1;
        const values = Array.from({ length: rollCount }, () => randomInt(rollSides) + 1);
        dice.roll({ sides: rollSides, count: rollCount, values, theme, duration: ROLL_DURATION, onComplete: () => {
            if (version !== session || state !== 'rolling') return;
            // Briefly show the dice at rest before the full-screen reveal.
            later(() => showResult(String(values.reduce((sum, value) => sum + value, 0))), 180);
        }});
    }

    function quadrant(x, y) { return (x >= innerWidth / 2 ? 1 : 0) + (y >= innerHeight / 2 ? 2 : 0); }

    function addFinger(event) {
        if (!['waiting', 'ready'].includes(state)) return;
        const max = currentMode === 'four-way' ? 4 : 10;
        if (fingers.size >= max || fingers.has(event.pointerId)) return;
        if (currentMode === 'wheel' && event.clientY <= innerHeight / 2) return;
        const area = quadrant(event.clientX, event.clientY);
        if (currentMode === 'four-way' && [...fingers.values()].some(f => f.quadrant === area)) return;
        const element = document.createElement('div');
        const color = nextFingerColor();
        element.className = 'finger-circle';
        element.style.left = `${event.clientX}px`;
        element.style.top = `${event.clientY}px`;
        element.style.backgroundColor = color;
        element.style.setProperty('--player-color', color);
        element.style.setProperty('--glow-color', color);
        game.appendChild(element);
        fingers.set(event.pointerId, { id: event.pointerId, element, color, quadrant: area });
        evaluateFingers();
    }

    function evaluateFingers() {
        cancelCharge();
        const enough = currentMode === 'four-way' ? fingers.size === 4 : fingers.size >= 2;
        state = enough ? 'ready' : 'waiting';
        fingers.forEach(f => f.element.classList.toggle('ready', enough));
        render();
        if (enough) startCharge(() => {
            if (currentMode === 'wheel') spinWheel();
            else if (currentMode === 'four-way') selectPairs();
            else chooseFingers();
        });
    }

    function chooseFingers() {
        const ids = [...fingers.keys()];
        const selected = sample(ids, Math.min(count, ids.length));
        showFingerResult(selectionMode === 'winner' ? selected : ids.filter(id => !selected.includes(id)));
    }

    function showFingerResult(ids) {
        winners = ids;
        state = 'result';
        $('wheel-area').classList.remove('visible');
        const colors = ids.map(id => fingers.get(id)?.color).filter(Boolean);
        game.style.background = colors.length > 1 ? `linear-gradient(120deg, ${colors.join(', ')})` : colors[0] || '';
        fingers.forEach(f => {
            f.element.classList.remove('ready', 'chosen');
            f.element.classList.add(ids.includes(f.id) ? 'chosen' : 'loser');
        });
        render();
    }

    function spinWheel() {
        state = 'rolling';
        const players = [...fingers.values()];
        const chosen = randomInt(players.length);
        const angle = 360 / players.length;
        const wheel = $('wheel-graphic');
        wheel.style.background = `conic-gradient(${players.map((f, i) => `${f.color} ${i * angle}deg ${(i + 1) * angle}deg`).join(',')})`;
        $('wheel-area').classList.add('visible');
        const offset = (0.2 + randomInt(600) / 1000) * angle;
        const rotation = 360 * 5 + 360 - (chosen * angle + offset);
        wheel.style.transition = 'none';
        wheel.style.transform = 'rotate(0deg)';
        void wheel.offsetWidth;
        wheel.style.transition = reducedMotion.matches ? 'none' : 'transform 2600ms cubic-bezier(0.12, 0.65, 0.12, 1)';
        wheel.style.transform = `rotate(${rotation}deg)`;
        render();
        later(() => showFingerResult([players[chosen].id]), reducedMotion.matches ? 300 : 2600);
    }

    function selectPairs() {
        state = 'pair';
        const players = [...fingers.values()];
        pairWinners = [sample(players.filter(f => f.quadrant % 2 === 0), 1)[0], sample(players.filter(f => f.quadrant % 2 === 1), 1)[0]];
        game.style.background = `linear-gradient(to right, ${pairWinners[0].color} 50%, ${pairWinners[1].color} 50%)`;
        fingers.forEach(f => {
            f.element.classList.remove('ready');
            f.element.classList.add(pairWinners.includes(f) ? 'chosen' : 'loser');
        });
        render();
        later(() => {
            game.style.background = '';
            pairWinners.forEach(f => f.element.classList.remove('chosen'));
            startCharge(() => showFingerResult([pairWinners[randomInt(2)].id]));
        }, 900);
    }

    function removeFinger(id) {
        const finger = fingers.get(id);
        if (!finger) return;
        if (state === 'result') {
            const isWinner = winners.includes(id);
            finger.element.remove();
            fingers.delete(id);
            if (isWinner || !fingers.size) resetRound();
            return;
        }
        if (state === 'pair' && !pairWinners.some(f => f.id === id)) {
            finger.element.remove();
            fingers.delete(id);
            return;
        }
        if (state === 'rolling' || state === 'pair') { resetRound(); return; }
        finger.element.remove();
        fingers.delete(id);
        evaluateFingers();
    }

    function isUI(event) { return !!event.target.closest('[data-ui], button, #menu-screen, #game-mode-switcher'); }

    game.addEventListener('pointerdown', event => {
        if (isPartyMode()) return;
        if (isUI(event) || overlayOpen || (event.pointerType === 'mouse' && event.button !== 0)) return;
        if (holdId === 'virtual' && state === 'result') {
            event.preventDefault();
            releaseHold('virtual');
            return;
        }
        if (currentMode === 'group') {
            if (state !== 'waiting' || groupPointers.has(event.pointerId)) return;
            event.preventDefault();
            game.setPointerCapture(event.pointerId);
            groupPointers.add(event.pointerId);
            addPlayer(event.clientX, event.clientY);
            return;
        }
        event.preventDefault();
        game.setPointerCapture(event.pointerId);
        if (isHoldMode()) startHold(event.pointerId);
        else addFinger(event);
    });

    game.addEventListener('pointermove', event => {
        if (isPartyMode()) return;
        const finger = fingers.get(event.pointerId);
        if (!finger || state === 'result') return;
        let x = event.clientX, y = event.clientY;
        if (currentMode === 'wheel') y = Math.max(innerHeight / 2 + 43, y);
        if (currentMode === 'four-way') {
            x = finger.quadrant % 2 ? Math.max(innerWidth / 2, x) : Math.min(innerWidth / 2 - 1, x);
            y = finger.quadrant >= 2 ? Math.max(innerHeight / 2, y) : Math.min(innerHeight / 2 - 1, y);
        }
        finger.element.style.left = `${x}px`;
        finger.element.style.top = `${y}px`;
    });

    function endPointer(event) {
        if (isPartyMode()) return;
        if (holdId === event.pointerId) {
            releaseHold(event.pointerId);
            return;
        }
        if (currentMode === 'group') {
            groupPointers.delete(event.pointerId);
        } else if (isClassic()) removeFinger(event.pointerId);
    }
    game.addEventListener('pointerup', endPointer);
    game.addEventListener('pointercancel', endPointer);
    game.addEventListener('lostpointercapture', endPointer);

    for (const id of ['dice-stage', 'number-stage', 'group-stage']) {
        $(id).tabIndex = 0;
        $(id).setAttribute('role', 'button');
        $(id).setAttribute('aria-label', id === 'group-stage' ? 'Join as the next player' : 'Hold Space or Enter to play');
        $(id).addEventListener('keydown', event => {
            if (![' ', 'Enter'].includes(event.key) || event.repeat) return;
            event.preventDefault();
            if (currentMode === 'group') addPlayer();
            else { holdKey = event.key; startHold('keyboard'); }
        });
        // Assistive activation can be a click without a physical hold.
        $(id).addEventListener('click', event => {
            if (event.detail !== 0) return;
            if (currentMode === 'group') addPlayer();
            else startHold('virtual');
        });
    }
    window.addEventListener('keyup', event => {
        if (holdId === 'keyboard' && event.key === holdKey) {
            event.preventDefault();
            releaseHold('keyboard');
        }
    });
    game.addEventListener('blur', () => { if (holdId === 'keyboard') releaseHold('keyboard'); });
    $('result-screen').addEventListener('click', () => releaseHold('virtual'));
    $('result-screen').addEventListener('keydown', event => {
        if (holdId === 'virtual' && [' ', 'Enter'].includes(event.key)) {
            event.preventDefault();
            releaseHold('virtual');
        }
    });

    function maxCount() {
        return currentMode === 'number' ? MAX_NUMBER : currentMode === 'multi-dice' ? 3 : currentMode === 'group' ? 100 : 10;
    }

    function changeCount(direction) {
        if (state !== 'waiting') return;
        count = Math.max(1, Math.min(maxCount(), count + direction));
        render();
        showDice();
    }
    function stopCountHold(cancelled = false) {
        if (!countHold) return;
        const press = countHold;
        countHold = null;
        clearTimeout(press.timer);
        // The browser sends a click after pointerup: a held arrow has already
        // applied its tens, so that release must not add an extra single step.
        if (press.repeated || cancelled) ignoredCountClick = press.button;
        if (press.button.hasPointerCapture(press.pointerId)) press.button.releasePointerCapture(press.pointerId);
    }

    for (const [id, direction] of [['up-arrow', 1], ['down-arrow', -1]]) {
        const button = $(id);
        button.addEventListener('pointerdown', event => {
            ignoredCountClick = null;
            if (currentMode !== 'number' || state !== 'waiting' || overlayOpen || button.disabled || event.button !== 0) return;
            stopCountHold(true);
            const press = { button, pointerId: event.pointerId, repeated: false, timer: null };
            countHold = press;
            button.setPointerCapture(event.pointerId);
            const repeat = () => {
                if (countHold !== press) return;
                if (currentMode !== 'number' || state !== 'waiting' || overlayOpen || !button.hasPointerCapture(press.pointerId)) { stopCountHold(true); return; }
                press.repeated = true;
                changeCount(direction * 10);
                if (button.disabled) stopCountHold();
                else press.timer = setTimeout(repeat, 100);
            };
            press.timer = setTimeout(repeat, 400);
        });
        button.addEventListener('click', event => {
            // Keyboard and assistive clicks have detail 0 and remain ordinary
            // single steps, even after a cancelled physical gesture.
            if (ignoredCountClick === button && event.detail !== 0) {
                ignoredCountClick = null;
                return;
            }
            changeCount(direction);
        });
        button.addEventListener('lostpointercapture', event => {
            if (countHold?.pointerId === event.pointerId) stopCountHold(true);
        });
    }
    window.addEventListener('pointerup', event => {
        if (countHold?.pointerId === event.pointerId) stopCountHold();
    });
    window.addEventListener('pointercancel', event => {
        if (countHold?.pointerId === event.pointerId) stopCountHold(true);
    });
    window.addEventListener('blur', () => {
        stopCountHold(true);
        if (isClassic() || currentMode === 'group') resetRound();
        else releaseHold(holdId);
    });
    $('reverse-button').addEventListener('click', () => {
        if (currentMode !== 'finger' || state !== 'waiting') return;
        selectionMode = selectionMode === 'winner' ? 'loser' : 'winner';
        render();
    });
    document.querySelectorAll('[data-sides]').forEach(button => button.addEventListener('click', () => {
        if (state !== 'waiting') return;
        sides = Number(button.dataset.sides);
        render();
        showDice();
    }));
    $('group-undo').addEventListener('click', () => { if (state === 'waiting') { groupPlayers.pop(); renderGroup(); } });
    $('group-clear').addEventListener('click', () => { if (state === 'waiting') { groupPlayers = []; renderGroup(); } });
    function startGroupPick() {
        if (state !== 'waiting' || overlayOpen || groupPlayers.length < 2) return;
        // Pick is a tap: the whole round runs without a held contact.
        const restoreFocus = document.activeElement === $('group-pick');
        if (restoreFocus) game.focus({ preventScroll: true });
        state = 'picking';
        const selected = sample(groupPlayers, Math.min(count, groupPlayers.length));
        render();
        renderGroup();
        startCharge(() => {
            state = 'result';
            game.classList.add('has-result');
            game.style.background = selected.length > 1 ? `linear-gradient(120deg, ${selected.map(player => player.color).join(', ')})` : selected[0].color;
            const numbers = selected.map(player => player.number);
            $('group-entries').querySelectorAll('.group-entry').forEach(entry => {
                entry.classList.remove('new-player');
                entry.classList.add(numbers.includes(Number(entry.dataset.number)) ? 'chosen' : 'loser');
            });
            $('group-status').textContent = `Selected: ${numbers.join(', ')}.`;
            render();
            later(() => {
                resetRound();
                if (restoreFocus && !overlayOpen) $('group-pick').focus({ preventScroll: true });
            }, GROUP_RESULT_DURATION);
        });
    }
    $('group-pick').setAttribute('aria-label', 'Pick');
    $('group-pick').addEventListener('click', startGroupPick);

    const onPartyChange = value => { partyUI = value; if (isPartyMode()) render(); };
    party = PickyParty.create({ game, color: playerColor, randomInt, onChange: onPartyChange });
    tournament = PickyTournament.create({ game, color: playerColor, randomInt, onChange: onPartyChange });

    navigation = PickyNavigation.init({
        onModeChange: switchMode,
        onThemeChange: setTheme,
        onOverlayChange: open => {
            overlayOpen = open;
            party.setOverlay(open);
            tournament.setOverlay(open);
            if (open) resetRound();
        }
    });
    dice.ready.then(() => { diceReady = true; render(); showDice(); }).catch(() => {
        diceFailed = true;
        render();
    });
    function resumeDefaults() {
        navigation.close();
        overlayOpen = false;
        resetSettings();
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) resumeDefaults(); });
    window.addEventListener('pagehide', resumeDefaults);
    window.addEventListener('pageshow', event => { if (event.persisted) resumeDefaults(); });
    window.addEventListener('resize', () => dice.resize());
    resetSettings();
})();
