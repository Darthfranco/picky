const test = require('node:test');
const assert = require('node:assert/strict');
const { modes, normalizePreferences } = require('../navigation.js');

test('new or malformed preferences keep dark appearance and the two default pins', () => {
    for (const input of [null, undefined, false, 1, 'light', {}, { pinned: null }]) {
        assert.deepEqual(normalizePreferences(input), { theme: 'dark', pinned: ['finger', 'wheel'] });
    }
});

test('stored pins stay unique, supported, ordered, and capped at three', () => {
    assert.deepEqual(normalizePreferences({
        theme: 'light', pinned: ['unknown', 'dice', 'dice', 'number', 'group', 'wheel']
    }), { theme: 'light', pinned: ['dice', 'number', 'group'] });
    assert.deepEqual(normalizePreferences({ theme: 'unexpected', pinned: [] }), { theme: 'dark', pinned: [] });
    assert.equal(new Set(modes.map(mode => mode.id)).size, 11);
});

test('team, ranking, and tournament modes can be pinned without changing defaults', () => {
    const newModes = ['teams', 'teams-group', 'ranking', 'tournament-group'];
    for (const id of newModes) {
        assert.ok(modes.some(mode => mode.id === id));
        assert.deepEqual(normalizePreferences({ pinned: ['finger', id] }).pinned, ['finger', id]);
    }
    assert.deepEqual(normalizePreferences(null).pinned, ['finger', 'wheel']);
});
