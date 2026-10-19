const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { _test: math } = require('../dice-renderer.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'dice-renderer.js'), 'utf8');
const asset = fs.readFileSync(path.join(__dirname, '..', 'assets/dice/models.json'), 'utf8');
const models = JSON.parse(asset).models;

test('Blender assets are tiny, closed, convex Platonic dice with conventional opposite values', () => {
    assert.match(JSON.parse(asset).generator, /^Blender /);
    assert.ok(Buffer.byteLength(asset) < 5000, 'All four models remain below 5 KB');
    for (const sides of [6, 8, 12, 20]) {
        const raw = models[sides];
        assert.equal(raw.faces.length, sides);
        assert.deepEqual([...raw.labels].sort((a, b) => a - b), Array.from({ length: sides }, (_, i) => i + 1));
        const model = math.prepareModel(raw);
        const edges = new Map();
        for (const face of model.faces) {
            assert.ok(math.dot(face.normal, face.center) > 0, 'Face normals point outward');
            const plane = math.dot(face.normal, face.center);
            for (const vertex of model.vertices) assert.ok(math.dot(face.normal, vertex) <= plane + 0.00001, 'Mesh is convex');
            for (let i = 0; i < face.indices.length; i++) {
                const pair = [face.indices[i], face.indices[(i + 1) % face.indices.length]].sort((a, b) => a - b).join(',');
                edges.set(pair, (edges.get(pair) || 0) + 1);
            }
            const opposite = model.faces.reduce((a, b) => math.dot(a.normal, face.normal) < math.dot(b.normal, face.normal) ? a : b);
            assert.ok(math.dot(opposite.normal, face.normal) < -0.99999);
            assert.equal(opposite.value + face.value, sides + 1);
        }
        assert.ok([...edges.values()].every(count => count === 2), 'Every edge belongs to two faces');
        assert.equal(raw.vertices.length - edges.size + raw.faces.length, 2, 'Closed sphere topology');
    }
});

test('every outcome lands on the most prominent visible face, for all die types and positions', () => {
    for (const raw of Object.values(models)) {
        const model = math.prepareModel(raw);
        for (let value = 1; value <= model.sides; value++) {
            for (let position = 0; position < 3; position++) {
                const orientation = math.orientationForFace(model, value, position);
                assert.ok(Math.abs(Math.hypot(...orientation) - 1) < 1e-8);
                const face = model.faces.find(item => item.value === value);
                const normal = math.rotate(face.normal, orientation);
                assert.ok(normal[2] > 0.87);
                assert.ok(model.faces.every(other => math.rotate(other.normal, orientation)[2] <= normal[2] + 1e-8));
                assert.ok(math.rotate(face.v, orientation)[1] > 0.9, 'Outcome numeral is upright');
            }
        }
    }
});

function rendererHarness({ reduced = false } = {}) {
    let now = 0;
    let nextFrame = 1;
    const frames = new Map();
    const calls = [];
    const context = new Proxy({}, {
        get(target, name) { return target[name] || ((...args) => calls.push([name, ...args])); },
        set(target, name, value) { target[name] = value; return true; }
    });
    const canvas = {
        width: 0, height: 0,
        getContext() { return context; },
        getBoundingClientRect() { return { width: 390, height: 400 }; }
    };
    const window = {
        document: { currentScript: { src: 'https://example.test/Picky/dice-renderer.js' } },
        devicePixelRatio: 3,
        fetch: async url => {
            assert.equal(url, 'https://example.test/Picky/assets/dice/models.json');
            return { ok: true, json: async () => JSON.parse(asset) };
        },
        performance: { now: () => now },
        matchMedia: () => ({ matches: reduced }),
        requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); }
    };
    vm.runInNewContext(source, { window, URL });
    return {
        instance: window.PickyDice.create(canvas), canvas, calls, frames,
        step(time) {
            now = time;
            const callbacks = [...frames.values()];
            frames.clear();
            callbacks.forEach(callback => callback(time));
        }
    };
}

test('idle dice use no animation loop; rolling yields requested outcomes and stops cleanly', async () => {
    const harness = rendererHarness();
    const { instance, canvas, frames } = harness;
    await instance.ready;
    assert.equal(frames.size, 0);
    assert.equal(canvas.width, 780, 'Device pixel ratio is capped at two');
    let result;
    const complete = instance.roll({ sides: 6, count: 3, values: [2, 4, 6], onComplete: values => { result = values; } });
    await new Promise(setImmediate);
    assert.equal(frames.size, 1);
    harness.step(500);
    assert.equal(result, undefined);
    harness.step(1300);
    assert.equal(await complete, true);
    assert.deepEqual([...result], [2, 4, 6]);
    assert.equal(frames.size, 0);
    instance.destroy();
});

test('leaving a mode cancels animation and never publishes its stale result', async () => {
    const harness = rendererHarness();
    await harness.instance.ready;
    let completed = 0;
    const roll = harness.instance.roll({ sides: 20, values: [20], onComplete: () => completed++ });
    await new Promise(setImmediate);
    harness.instance.cancel();
    harness.step(2000);
    assert.equal(await roll, false);
    assert.equal(completed, 0);
    assert.equal(harness.frames.size, 0);
    harness.instance.show({ sides: 12, theme: 'light' });
    await new Promise(setImmediate);
    assert.equal(harness.frames.size, 0);
    harness.instance.destroy();
});

test('reduced motion preserves the result with a brief, non-spinning transition', async () => {
    const harness = rendererHarness({ reduced: true });
    await harness.instance.ready;
    let result;
    const roll = harness.instance.roll({ sides: 8, values: [8], onComplete: values => { result = values; } });
    await new Promise(setImmediate);
    harness.step(120);
    assert.equal(await roll, true);
    assert.deepEqual([...result], [8]);
    assert.equal(harness.frames.size, 0);
});
