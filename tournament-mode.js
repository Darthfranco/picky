(() => {
    'use strict';

    const HOLD_TIME = 2400;
    const READ_TIME = 1500;

    function create({ game, color, randomInt, onChange }) {
        const layer = document.createElement('section');
        layer.id = 'tournament-stage';
        layer.hidden = true;
        layer.setAttribute('aria-label', 'Tournament 5+');
        layer.innerHTML = `
            <div id="tournament-controls" data-ui aria-label="Tournament players">
                <button class="selector-button" id="tournament-down" aria-label="Fewer tournament players"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>
                <div id="tournament-count-display"><span id="tournament-count">10</span><span>Players</span></div>
                <button class="selector-button" id="tournament-up" aria-label="More tournament players"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg></button>
            </div>
            <div id="tournament-prompt" aria-live="polite" aria-atomic="true">
                <h1 id="tournament-round">Round 1</h1>
                <p id="tournament-needed">Place 5 fingers</p>
            </div>
            <div id="tournament-dots"></div>
            <p id="tournament-status" class="visually-hidden" role="status"></p>`;
        game.append(layer);

        const $ = id => layer.querySelector(`#${id}`);
        const contacts = new Map();
        let active = false;
        let overlayOpen = false;
        let total = 10;
        let batches = [];
        let batchIndex = 0;
        let finalists = [];
        let finalRound = false;
        let phase = 'waiting';
        let chargeTimer = null;
        let readTimer = null;
        let generation = 0;
        let resultColor = null;

        function expectedPlayers() {
            return finalRound ? finalists : batches[batchIndex];
        }

        function cancelCharge() {
            clearTimeout(chargeTimer);
            chargeTimer = null;
            game.classList.remove('charging');
        }

        function clearContacts() {
            const ids = [...contacts.keys()];
            contacts.clear();
            $('tournament-dots').replaceChildren();
            for (const id of ids) {
                if (game.hasPointerCapture(id)) game.releasePointerCapture(id);
            }
        }

        function cancelPending() {
            generation++;
            cancelCharge();
            clearTimeout(readTimer);
            readTimer = null;
        }

        function clearResultBackground() {
            if (resultColor !== null) game.style.background = '';
            resultColor = null;
        }

        function freshTournament() {
            cancelPending();
            clearContacts();
            clearResultBackground();
            const players = Array.from({ length: total }, (_, index) => ({ number: index + 1, color: color(index) }));
            batches = PickyPartyRules.tournamentBatches(players);
            batchIndex = 0;
            finalists = [];
            finalRound = false;
            phase = 'waiting';
            render();
        }

        function paintDot(contact) {
            const player = contact.player;
            const fill = player?.color || color(total);
            contact.element.dataset.number = player ? player.number : '';
            contact.element.style.setProperty('--glow-color', fill);
            contact.element.style.setProperty('--player-color', fill);
            contact.element.setAttribute('aria-label', player ? `Player ${player.number}` : 'Extra finger');
        }

        function assignPlayers() {
            const players = expectedPlayers();
            const assigned = new Set();
            contacts.forEach(contact => {
                if (contact.player) assigned.add(contact.player.number);
            });
            contacts.forEach(contact => {
                if (!contact.player) {
                    contact.player = players.find(player => !assigned.has(player.number));
                    if (contact.player) assigned.add(contact.player.number);
                }
                paintDot(contact);
            });
        }

        function render() {
            if (!active) return;
            const playing = phase !== 'waiting';
            const occupied = contacts.size > 0;
            layer.dataset.phase = phase;
            layer.dataset.round = finalRound ? 'final' : String(batchIndex + 1);
            layer.dataset.expected = expectedPlayers().length;
            $('tournament-controls').hidden = occupied || playing || batchIndex !== 0 || finalRound;
            $('tournament-count').textContent = total;
            $('tournament-down').disabled = total <= 6;
            $('tournament-up').disabled = total >= 25;
            $('tournament-prompt').hidden = playing;
            $('tournament-round').textContent = finalRound ? 'Winners bracket' : `Round ${batchIndex + 1}`;
            $('tournament-needed').textContent = `Place ${expectedPlayers().length} fingers`;
            onChange({ busy: occupied || playing, hideLogo: occupied || playing, compactLogo: true });
        }

        function evaluate() {
            if (phase === 'result') return;
            cancelCharge();
            assignPlayers();
            phase = 'waiting';
            if (contacts.size === expectedPlayers().length) {
                phase = 'holding';
                void game.offsetWidth;
                game.classList.add('charging');
                const version = generation;
                chargeTimer = setTimeout(() => {
                    chargeTimer = null;
                    if (!active || version !== generation || phase !== 'holding') return;
                    game.classList.remove('charging');
                    const winner = expectedPlayers()[randomInt(expectedPlayers().length)];
                    if (!finalRound) finalists.push(winner);
                    resultColor = winner.color;
                    game.style.background = resultColor;
                    contacts.forEach(contact => {
                        const chosen = contact.player.number === winner.number;
                        contact.element.classList.toggle('chosen', chosen);
                        contact.element.classList.toggle('loser', !chosen);
                        contact.element.dataset.winner = chosen ? 'true' : 'false';
                    });
                    phase = 'result';
                    $('tournament-status').textContent = 'Chosen';
                    render();
                }, HOLD_TIME);
            }
            render();
        }

        function nextRound() {
            clearResultBackground();
            if (finalRound) {
                freshTournament();
                return;
            }
            clearContacts();
            batchIndex++;
            if (batchIndex === batches.length) finalRound = true;
            phase = 'waiting';
            render();
        }

        function setPosition(contact, event) {
            const rect = game.getBoundingClientRect();
            contact.element.style.left = `${(event.clientX - rect.left) / rect.width * 100}%`;
            contact.element.style.top = `${(event.clientY - rect.top) / rect.height * 100}%`;
        }

        function pointerDown(event) {
            if (!active || overlayOpen || game.inert || phase === 'result' || event.target.closest('[data-ui], button, a, input, select, textarea')) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            if (contacts.has(event.pointerId)) return;
            event.preventDefault();
            const element = document.createElement('div');
            element.className = 'finger-circle tournament-dot';
            const contact = { element, player: null };
            setPosition(contact, event);
            contacts.set(event.pointerId, contact);
            $('tournament-dots').append(element);
            game.setPointerCapture(event.pointerId);
            evaluate();
        }

        function pointerMove(event) {
            if (!active || phase === 'result') return;
            const contact = contacts.get(event.pointerId);
            if (contact) setPosition(contact, event);
        }

        function pointerEnd(event) {
            if (!active || !contacts.has(event.pointerId)) return;
            const contact = contacts.get(event.pointerId);
            contacts.delete(event.pointerId);
            if (phase === 'result') {
                if (!contacts.size && readTimer === null) {
                    const version = generation;
                    readTimer = setTimeout(() => {
                        readTimer = null;
                        if (active && generation === version) nextRound();
                    }, READ_TIME);
                }
            } else {
                contact.element.remove();
                evaluate();
            }
        }

        function blur() {
            if (!active) return;
            clearResultBackground();
            if (phase === 'result') {
                // Focus can leave without a visibility change or pointerup.
                // Finish releasing this result once, retaining its chosen winner.
                for (const pointerId of [...contacts.keys()]) {
                    pointerEnd({ pointerId });
                    if (game.hasPointerCapture(pointerId)) game.releasePointerCapture(pointerId);
                }
            } else {
                cancelPending();
                clearContacts();
                phase = 'waiting';
                render();
            }
        }

        game.addEventListener('pointerdown', pointerDown);
        game.addEventListener('pointermove', pointerMove);
        game.addEventListener('pointerup', pointerEnd);
        game.addEventListener('pointercancel', pointerEnd);
        game.addEventListener('lostpointercapture', pointerEnd);
        window.addEventListener('blur', blur);
        $('tournament-down').addEventListener('click', () => adjust(-1));
        $('tournament-up').addEventListener('click', () => adjust(1));

        function adjust(amount) {
            if (!active || contacts.size || phase !== 'waiting' || batchIndex !== 0 || finalRound) return;
            total = Math.max(6, Math.min(25, total + amount));
            freshTournament();
        }

        return {
            enter(mode) {
                if (mode !== 'tournament-group') return;
                active = true;
                overlayOpen = false;
                total = 10;
                layer.hidden = false;
                freshTournament();
            },
            leave() {
                active = false;
                cancelPending();
                clearContacts();
                clearResultBackground();
                layer.hidden = true;
            },
            reset() {
                total = 10;
                freshTournament();
            },
            setTheme() {
                batches.flat().forEach(player => { player.color = color(player.number - 1); });
                contacts.forEach(paintDot);
            },
            setOverlay(open) {
                overlayOpen = open;
                if (active && open) clearResultBackground();
                if (active && open && phase !== 'result') {
                    cancelPending();
                    clearContacts();
                    phase = 'waiting';
                    render();
                }
            }
        };
    }

    window.PickyTournament = Object.freeze({ create });
})();
