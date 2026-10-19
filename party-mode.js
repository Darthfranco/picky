(function (root) {
    'use strict';
    const MODES = new Set(['teams', 'teams-group', 'ranking']);
    const HOLD_MS = 2400;
    const READ_MS = 1500;

    function create({ game, color, randomInt, onChange }) {
        const layer = document.createElement('div');
        layer.id = 'party-layer';
        layer.hidden = true;
        layer.innerHTML = `
            <svg id="party-links" aria-hidden="true" preserveAspectRatio="none"></svg>
            <div id="party-dots" aria-label="Players"></div>
            <div id="party-controls" data-ui aria-label="Team count">
                <button id="party-down" class="selector-button" aria-label="Fewer teams"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>
                <div><span id="party-count">2</span><span class="party-control-label">Teams</span></div>
                <button id="party-up" class="selector-button" aria-label="More teams"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg></button>
            </div>
            <p id="party-hint"></p>
            <div id="party-actions" data-ui>
                <button id="party-undo">Undo</button><button id="party-clear">Clear</button><button id="party-pick" aria-label="Hold to choose teams">Pick</button>
            </div>
            <p id="party-status" class="visually-hidden" role="status"></p>`;
        game.append(layer);
        const $ = id => layer.querySelector(`#${id}`);
        let mode = null, phase = 'waiting', teamCount = 2, overlay = false;
        let players = [], nextNumber = 1, holdId = null, holdKey = null;
        let charge = null, readback = null, teams = [], limitHint = false;
        const contacts = new Set();
        const group = () => mode === 'teams-group';
        const isTeams = () => mode === 'teams' || group();
        const enough = () => players.length >= (isTeams() ? teamCount : 2) && players.length <= (isTeams() ? teamCount * 4 : 5);

        function clearTimers() {
            clearTimeout(charge); clearTimeout(readback);
            charge = readback = null;
            game.classList.remove('charging');
        }

        function notify() {
            if (!mode) return;
            onChange({ busy: phase !== 'waiting', hideLogo: phase !== 'waiting' || (!group() && players.length > 0), compactLogo: group() });
        }

        function render() {
            if (!mode) return;
            layer.dataset.phase = phase;
            layer.dataset.mode = mode;
            const busy = phase !== 'waiting';
            $('party-controls').hidden = !isTeams() || busy;
            $('party-count').textContent = teamCount;
            $('party-down').disabled = teamCount <= Math.max(2, Math.ceil(players.length / 4));
            $('party-up').disabled = teamCount >= 5;
            $('party-actions').hidden = !group() || busy;
            $('party-undo').disabled = !players.length;
            $('party-clear').disabled = !players.length;
            $('party-pick').disabled = !enough();
            const tooMany = isTeams() && players.length > teamCount * 4;
            $('party-hint').textContent = mode === 'ranking' && players.length > 5 ? '5 fingers max' : players.length > 20 || limitHint ? '20 players max' : tooMany ? 'Add a team' : group() && !players.length ? 'Tap once. Remember your number.' : '';
            $('party-hint').hidden = busy || !$('party-hint').textContent;
            notify();
        }

        function dotInk(hex) {
            const values = hex.slice(1).match(/../g).map(v => {
                const c = parseInt(v, 16) / 255;
                return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
            });
            return values[0] * .2126 + values[1] * .7152 + values[2] * .0722 > .179 ? '#161310' : '#FFF9EE';
        }

        function paintPlayer(player) {
            const fill = player.team ? color(player.team - 1) : color(player.number - 1);
            player.element.style.setProperty('--player-color', fill);
            player.element.style.setProperty('--glow-color', fill);
            player.element.style.setProperty('--dot-ink', dotInk(fill));
            player.element.style.backgroundColor = fill;
            player.element.style.left = `${player.x * 100}%`;
            player.element.style.top = `${player.y * 100}%`;
            player.element.dataset.player = player.number;
            if (player.team) player.element.dataset.team = player.team;
            else delete player.element.dataset.team;
            player.element.classList.toggle('is-labelled', group() || !!player.rank);
            player.element.replaceChildren();
            if (group() || player.rank) {
                const label = document.createElement('span');
                label.className = player.rank ? 'party-rank' : 'party-player-number';
                label.textContent = player.rank || player.number;
                player.element.append(label);
            }
            player.element.setAttribute('aria-label', player.rank ? `Rank ${player.rank}` : `Player ${player.number}${player.team ? `, team ${player.team}` : ''}`);
        }

        function drawLinks() {
            const svg = $('party-links');
            svg.replaceChildren();
            const { width, height } = game.getBoundingClientRect();
            svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
            // A short spanning tree connects every teammate without a web of edges.
            for (let index = 0; index < teams.length; index++) {
                const connected = [teams[index][0]], remaining = teams[index].slice(1);
                while (remaining.length) {
                    let best = null;
                    for (const from of connected) for (let i = 0; i < remaining.length; i++) {
                        const to = remaining[i];
                        const distance = ((from.x - to.x) * width) ** 2 + ((from.y - to.y) * height) ** 2;
                        if (!best || distance < best.distance) best = { from, to, i, distance };
                    }
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.dataset.team = index + 1;
                    for (const [name, value] of Object.entries({ x1: best.from.x * width, y1: best.from.y * height, x2: best.to.x * width, y2: best.to.y * height, stroke: color(index) })) line.setAttribute(name, value);
                    svg.append(line);
                    connected.push(best.to); remaining.splice(best.i, 1);
                }
            }
        }

        function cancelRound({ clearPlayers = !group() } = {}) {
            clearTimers();
            const captured = [...contacts];
            if (typeof holdId === 'number') captured.push(holdId);
            contacts.clear(); holdId = holdKey = null;
            phase = 'waiting'; teams = []; limitHint = false;
            if (clearPlayers) {
                players.forEach(p => p.element.remove()); players = []; nextNumber = 1;
            } else {
                players.forEach(p => { delete p.team; delete p.rank; paintPlayer(p); });
            }
            $('party-links').replaceChildren();
            captured.forEach(id => { if (game.hasPointerCapture(id)) game.releasePointerCapture(id); });
            render();
        }

        function finish() {
            charge = null;
            game.classList.remove('charging');
            phase = 'result';
            if (isTeams()) {
                teams = PickyPartyRules.balancedTeams(players, teamCount, randomInt);
                teams.forEach((team, index) => team.forEach(player => { player.team = index + 1; }));
            } else {
                PickyPartyRules.rankPlayers(players, randomInt).forEach(({ player, rank }) => { player.rank = rank; });
            }
            players.forEach(paintPlayer);
            drawLinks();
            $('party-status').textContent = isTeams() ? teams.map((team, i) => `Team ${i + 1}: ${team.map(p => p.number).join(', ')}`).join('. ') : 'Ranks chosen.';
            render();
        }

        function startCharge() {
            clearTimers();
            phase = 'charging';
            render();
            void game.offsetWidth;
            game.classList.add('charging');
            charge = setTimeout(finish, HOLD_MS);
        }

        function evaluate() {
            clearTimers();
            phase = 'waiting';
            if (!group() && enough()) startCharge();
            else render();
        }

        function addPlayer(event, virtual = false) {
            if (group() && players.length >= 20) {
                limitHint = true; render();
                return false;
            }
            const bounds = game.getBoundingClientRect();
            const element = document.createElement('div');
            element.className = `party-dot ${group() ? 'group-entry' : 'finger-circle'}`;
            const player = { number: nextNumber++, pointer: event.pointerId, x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height, element };
            players.push(player); $('party-dots').append(element); paintPlayer(player);
            limitHint = false;
            if (!virtual) { contacts.add(event.pointerId); game.setPointerCapture(event.pointerId); }
            $('party-status').textContent = `Player ${player.number}`;
            evaluate();
            return true;
        }

        function beginPick(id, key) {
            if (!mode || !group() || overlay || phase !== 'waiting' || !enough()) return;
            holdId = id; holdKey = key;
            if (id === 'keyboard') game.focus({ preventScroll: true });
            startCharge();
        }

        function startReadback() {
            if (readback !== null) return;
            const keyboard = holdId === 'keyboard';
            holdId = holdKey = null;
            readback = setTimeout(() => {
                cancelRound();
                if (keyboard && group()) $('party-pick').focus({ preventScroll: true });
            }, READ_MS);
        }

        function endContact(event) {
            if (!mode) return;
            if (group()) {
                contacts.delete(event.pointerId);
                if (holdId !== event.pointerId) return;
                if (phase === 'result') startReadback();
                else cancelRound();
                return;
            }
            if (!contacts.delete(event.pointerId)) return;
            if (phase === 'result') {
                if (!contacts.size) startReadback();
                return;
            }
            const player = players.find(p => p.pointer === event.pointerId);
            player?.element.remove(); players = players.filter(p => p !== player);
            evaluate();
        }

        game.addEventListener('pointerdown', event => {
            if (!mode || overlay || game.inert || !['waiting', 'charging'].includes(phase) || event.target.closest('[data-ui],button') || (event.pointerType === 'mouse' && event.button !== 0)) return;
            if (group() && phase !== 'waiting') return;
            event.preventDefault(); addPlayer(event);
        });
        game.addEventListener('pointermove', event => {
            if (!mode || group() || phase === 'result') return;
            const player = players.find(p => p.pointer === event.pointerId);
            if (!player) return;
            const bounds = game.getBoundingClientRect();
            player.x = (event.clientX - bounds.left) / bounds.width; player.y = (event.clientY - bounds.top) / bounds.height;
            paintPlayer(player);
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) game.addEventListener(type, endContact);
        for (const [id, direction] of [['party-up', 1], ['party-down', -1]]) $(id).addEventListener('click', () => {
            if (phase !== 'waiting') return;
            teamCount = Math.max(2, Math.min(5, teamCount + direction));
            evaluate();
        });
        $('party-undo').addEventListener('click', () => {
            if (phase !== 'waiting') return;
            const player = players.pop(); player?.element.remove();
            nextNumber = players.length + 1; limitHint = false; render();
        });
        $('party-clear').addEventListener('click', () => { if (phase === 'waiting') cancelRound({ clearPlayers: true }); });
        $('party-pick').addEventListener('pointerdown', event => {
            if (event.button !== 0 || phase !== 'waiting' || !enough()) return;
            event.preventDefault(); game.setPointerCapture(event.pointerId); beginPick(event.pointerId);
        });
        $('party-pick').addEventListener('keydown', event => {
            if (![' ', 'Enter'].includes(event.key) || event.repeat) return;
            event.preventDefault(); beginPick('keyboard', event.key);
        });
        function virtualJoin() {
            if (!mode || !group() || overlay || phase !== 'waiting') return;
            const bounds = game.getBoundingClientRect();
            addPlayer({ clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }, true);
        }
        $('party-dots').addEventListener('keydown', event => {
            if (![' ', 'Enter'].includes(event.key) || event.repeat) return;
            event.preventDefault(); virtualJoin();
        });
        $('party-dots').addEventListener('click', event => { if (event.detail === 0) virtualJoin(); });
        window.addEventListener('keyup', event => {
            if (!mode || holdId !== 'keyboard' || event.key !== holdKey) return;
            event.preventDefault();
            if (phase === 'result') startReadback();
            else { cancelRound(); $('party-pick').focus({ preventScroll: true }); }
        });
        window.addEventListener('blur', () => { if (mode && (contacts.size || holdId !== null)) cancelRound(); });
        game.addEventListener('blur', () => { if (mode && holdId === 'keyboard') cancelRound(); });
        window.addEventListener('resize', () => { if (mode && phase === 'result') drawLinks(); });

        return {
            enter(value) {
                mode = MODES.has(value) ? value : null;
                if (!mode) return;
                overlay = false; teamCount = 2; layer.hidden = false;
                $('party-dots').tabIndex = group() ? 0 : -1;
                if (group()) { $('party-dots').setAttribute('role', 'button'); $('party-dots').setAttribute('aria-label', 'Join as the next player'); }
                else { $('party-dots').removeAttribute('role'); $('party-dots').setAttribute('aria-label', 'Players'); }
                cancelRound({ clearPlayers: true });
            },
            leave() { if (!mode) return; cancelRound({ clearPlayers: true }); mode = null; layer.hidden = true; },
            reset() { if (!mode) return; teamCount = 2; cancelRound({ clearPlayers: true }); },
            setOverlay(open) { overlay = open; if (mode && open) cancelRound(); },
            setTheme() { if (mode) { players.forEach(paintPlayer); drawLinks(); } }
        };
    }
    root.PickyParty = { create };
})(window);
