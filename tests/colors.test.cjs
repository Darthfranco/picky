const test = require('node:test');
const assert = require('node:assert/strict');
const { palette, selectColor } = require('../color-palette.js');

const distinctHues = ['#00E5FF', '#FF00FF', '#76FF03', '#FF9100', '#5C5CFF'];

function deal(available, active) {
    const color = selectColor(available, active);
    if (color) available.splice(available.indexOf(color), 1);
    return color;
}

test('all wheel sizes use distinct base hues regardless of shuffled palette order', () => {
    for (let offset = 0; offset < palette.length; offset++) {
        for (const order of [palette, [...palette].reverse()]) {
            const available = [...order.slice(offset), ...order.slice(0, offset)];
            const active = [];
            for (let player = 0; player < 5; player++) {
                active.push(deal(available, active));
                assert.equal(new Set(active).size, active.length);
                assert.ok(active.every(color => distinctHues.includes(color)));
            }
            assert.deepEqual(new Set(active), new Set(distinctHues));
        }
    }
});

test('new players are separated from all active colors, even with a similar shade first in the pool', () => {
    assert.equal(selectColor(['#00B0FF', '#FF00FF', '#FF9100'], ['#00E5FF']), '#FF00FF');
    assert.equal(selectColor(['#FF00FF', '#76FF03', '#FF9100'], ['#5C5CFF', '#00E5FF']), '#FF9100');
});

test('ten players receive unique colors, using neighboring shades only after the five base hues', () => {
    const available = [...palette].reverse();
    const active = [];
    for (let player = 0; player < 10; player++) active.push(deal(available, active));
    assert.equal(new Set(active).size, 10);
    assert.deepEqual(new Set(active.slice(0, 5)), new Set(distinctHues));
    assert.deepEqual(new Set(active), new Set(palette));
    assert.equal(deal(available, active), undefined);
});

test('replacing a lifted finger preserves the other players and reuses a distinct hue', () => {
    const available = [...palette];
    const active = [];
    for (let player = 0; player < 5; player++) active.push(deal(available, active));
    const released = active.splice(2, 1)[0];
    available.unshift(released);
    const before = [...active];
    assert.equal(deal(available, active), released);
    assert.deepEqual(active, before);
});

test('selection does not mutate its inputs or choose an active color from a stale pool', () => {
    const available = Object.freeze([...palette]);
    const active = Object.freeze([palette[0], palette[1]]);
    const selected = selectColor(available, active);
    assert.ok(!active.includes(selected));
    assert.equal(selectColor([palette[0]], [palette[0]]), undefined);
});
