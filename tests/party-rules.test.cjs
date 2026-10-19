const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rules = require('../party-rules.js');
const { shuffle, balancedTeams, rankPlayers, tournamentBatches } = rules;

const players = count => Object.freeze(Array.from({ length: count }, (_, id) => Object.freeze({ id })));
const first = () => 0;

function samePlayers(actual, expected) {
    assert.equal(actual.length, expected.length);
    assert.equal(new Set(actual).size, expected.length);
    assert.ok(expected.every(player => actual.includes(player)));
}

test('teams stay balanced, distinct, and within capacity for every supported roster', () => {
    for (let count = 2; count <= 5; count++) {
        for (let size = count; size <= count * 4; size++) {
            const roster = players(size);
            const teams = balancedTeams(roster, count, first);
            assert.equal(teams.length, count);
            assert.ok(teams.every(team => team.length >= 1 && team.length <= 4));
            const sizes = teams.map(team => team.length);
            assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
            samePlayers(teams.flat(), roster);
        }
    }
    assert.deepEqual(balancedTeams(players(5), 2, first).map(team => team.length), [3, 2]);
});

test('teams reject impossible requests instead of silently dropping players or adding teams', () => {
    for (const count of [0, 1, 6, 2.5, NaN]) {
        assert.throws(() => balancedTeams(players(5), count, first), RangeError);
    }
    assert.throws(() => balancedTeams(players(4), 5, first), RangeError);
    assert.throws(() => balancedTeams(players(9), 2, first), RangeError);
    assert.throws(() => balancedTeams(players(21), 5, first), RangeError);
});

test('shuffle gives each three-player order exactly one equally likely random path', () => {
    const roster = players(3);
    const results = new Set();
    for (let firstChoice = 0; firstChoice < 3; firstChoice++) {
        for (let secondChoice = 0; secondChoice < 2; secondChoice++) {
            const choices = [firstChoice, secondChoice];
            const bounds = [];
            const shuffled = shuffle(roster, bound => {
                bounds.push(bound);
                return choices.shift();
            });
            samePlayers(shuffled, roster);
            assert.deepEqual(bounds, [3, 2]);
            results.add(shuffled.map(player => player.id).join(','));
        }
    }
    assert.equal(results.size, 6);
    assert.deepEqual(roster.map(player => player.id), [0, 1, 2]);
});

test('rankings assign every player a distinct consecutive rank without changing players', () => {
    for (let size = 1; size <= 5; size++) {
        const roster = players(size);
        const ranked = rankPlayers(roster, first);
        samePlayers(ranked.map(entry => entry.player), roster);
        assert.deepEqual(ranked.map(entry => entry.rank), Array.from({ length: size }, (_, index) => index + 1));
        assert.ok(roster.every(player => !Object.hasOwn(player, 'rank')));
    }
});

test('all 6–25-player tournaments have balanced opening rounds with no singleton byes', () => {
    for (let size = 6; size <= 25; size++) {
        const roster = players(size);
        const batches = tournamentBatches(roster);
        const sizes = batches.map(batch => batch.length);
        assert.equal(batches.length, Math.ceil(size / 5));
        assert.ok(sizes.every(length => length >= 2 && length <= 5));
        assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
        assert.deepEqual(batches.flat(), roster);
    }
    assert.deepEqual(tournamentBatches(players(6)).map(batch => batch.length), [3, 3]);
    assert.deepEqual(tournamentBatches(players(11)).map(batch => batch.length), [4, 4, 3]);
    assert.deepEqual(tournamentBatches(players(25)).map(batch => batch.length), [5, 5, 5, 5, 5]);
});

test('one winner per opening batch produces a complete winners bracket and one champion', () => {
    for (let size = 6; size <= 25; size++) {
        const roster = players(size);
        const opening = tournamentBatches(roster);
        const winners = opening.map(batch => batch.at(-1));
        const final = tournamentBatches(winners);
        assert.equal(final.length, 1);
        assert.ok(final[0].length >= 2 && final[0].length <= 5);
        assert.deepEqual(final[0], winners);
        const champion = final[0][0];
        assert.ok(roster.includes(champion));
        assert.deepEqual(tournamentBatches([champion]), [[champion]]);
    }
});

test('batch planner handles empty rounds and unavoidable byes without inventing entrants', () => {
    assert.deepEqual(tournamentBatches([]), []);
    assert.deepEqual(tournamentBatches([1, 2, 3], 2), [[1, 2], [3]]);
    assert.deepEqual(tournamentBatches([1, 2, 3, 4, 5], 3), [[1, 2, 3], [4, 5]]);
    for (const maxSize of [0, 1, 2.5, NaN, Infinity]) {
        assert.throws(() => tournamentBatches([1, 2], maxSize), RangeError);
    }
});

test('invalid inputs and random sources fail clearly', () => {
    assert.throws(() => shuffle(null, first), TypeError);
    assert.throws(() => tournamentBatches({ length: 3 }), TypeError);
    assert.throws(() => shuffle([1, 2]), TypeError);
    for (const invalid of [-1, 2, 0.5, NaN, Infinity, undefined]) {
        assert.throws(() => shuffle([1, 2], () => invalid), RangeError);
    }
});

test('the same small module exposes a browser global without a bundler', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(require.resolve('../party-rules.js'), 'utf8'), context);
    assert.equal(typeof context.PickyPartyRules.balancedTeams, 'function');
    assert.ok(Object.isFrozen(context.PickyPartyRules));
    assert.deepEqual(Object.keys(context.PickyPartyRules), Object.keys(rules));
});
