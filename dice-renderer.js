/* Tiny perspective renderer for the meshes authored in Blender by tools/build-dice.py.
 * No WebGL, textures, runtime dependency, or idle animation loop is required.
 */
(function (root, factory) {
    const api = factory(root);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PickyDice = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const scriptUrl = root.document?.currentScript?.src || root.document?.baseURI;
    const modelsUrl = scriptUrl ? new URL('assets/dice/models.json', scriptUrl).href : '';
    const TAU = Math.PI * 2;
    const add = (a, b) => a.map((value, i) => value + b[i]);
    const sub = (a, b) => a.map((value, i) => value - b[i]);
    const mul = (a, amount) => a.map(value => value * amount);
    const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = vector => mul(vector, 1 / (Math.hypot(...vector) || 1));

    function quaternionMultiply(a, b) {
        return [
            a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
        ];
    }

    function rotate(point, quaternion) {
        const vector = quaternion.slice(0, 3);
        const twice = mul(cross(vector, point), 2);
        return add(point, add(mul(twice, quaternion[3]), cross(vector, twice)));
    }

    function fromEuler(x, y, z) {
        const qx = [Math.sin(x / 2), 0, 0, Math.cos(x / 2)];
        const qy = [0, Math.sin(y / 2), 0, Math.cos(y / 2)];
        const qz = [0, 0, Math.sin(z / 2), Math.cos(z / 2)];
        return quaternionMultiply(qz, quaternionMultiply(qy, qx));
    }

    function slerp(a, b, t) {
        let cosine = dot(a, b);
        if (cosine < 0) { b = mul(b, -1); cosine = -cosine; }
        if (cosine > 0.9995) return unit(add(mul(a, 1 - t), mul(b, t)));
        const angle = Math.acos(Math.min(1, cosine));
        return add(mul(a, Math.sin((1 - t) * angle) / Math.sin(angle)), mul(b, Math.sin(t * angle) / Math.sin(angle)));
    }

    function prepareModel(raw) {
        const vertices = raw.vertices;
        const faces = raw.faces.map((indices, i) => {
            const points = indices.map(index => vertices[index]);
            const center = mul(points.reduce(add, [0, 0, 0]), 1 / points.length);
            const normal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
            const u = unit(sub(points[1], points[0]));
            const v = unit(cross(normal, u));
            return { indices, center, normal, u, v, value: raw.labels[i] };
        });
        return { vertices, faces, sides: faces.length };
    }

    // Rotate the chosen face toward the viewer, keep its label upright, then
    // apply a small tilt so the landed die still visibly has depth.
    function orientationForFace(model, value, index = 0) {
        const face = model.faces.find(item => item.value === value) || model.faces[0];
        const z = [0, 0, 1];
        const cosine = dot(face.normal, z);
        let facing = cosine < -0.99999 ? [1, 0, 0, 0] : unit([...cross(face.normal, z), 1 + cosine]);
        const up = rotate(face.v, facing);
        facing = quaternionMultiply(fromEuler(0, 0, Math.atan2(up[0], up[1])), facing);
        const tilt = model.sides === 6 ? fromEuler(-0.31, -0.38, index % 2 ? -0.10 : 0.08) : fromEuler(-0.10, -0.12, 0.03);
        return quaternionMultiply(tilt, facing);
    }

    let modelsPromise;
    function loadModels() {
        if (!modelsPromise) {
            modelsPromise = root.fetch(modelsUrl).then(response => {
                if (!response.ok) throw new Error('Dice models could not be loaded.');
                return response.json();
            }).then(data => Object.fromEntries(Object.entries(data.models).map(([sides, raw]) => [sides, prepareModel(raw)])))
                .catch(error => { modelsPromise = null; throw error; });
        }
        return modelsPromise;
    }

    const pipLayouts = {
        1: [[0, 0]],
        2: [[-1, 1], [1, -1]],
        3: [[-1, 1], [0, 0], [1, -1]],
        4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
        5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
        6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]]
    };

    function create(canvas) {
        const context = canvas.getContext('2d', { alpha: true });
        if (!context) throw new Error('The dice canvas is unavailable.');
        let models;
        let config = { sides: 6, count: 1, theme: 'dark' };
        let values = [1];
        let orientations = [];
        let width = 1, height = 1, pixelRatio = 1;
        let destroyed = false, revision = 0, frame = 0, animation = null;
        let completion;

        function measure() {
            const rect = canvas.getBoundingClientRect();
            width = Math.max(1, rect.width || canvas.clientWidth || 300);
            height = Math.max(1, rect.height || canvas.clientHeight || 300);
            pixelRatio = Math.min(root.devicePixelRatio || 1, 2);
            if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
                canvas.width = Math.round(width * pixelRatio);
                canvas.height = Math.round(height * pixelRatio);
            }
        }

        function settings(options = {}) {
            const sides = [6, 8, 12, 20].includes(Number(options.sides)) ? Number(options.sides) : config.sides;
            const count = sides === 6 ? Math.max(1, Math.min(3, Math.round(Number(options.count) || config.count))) : 1;
            config = { sides, count, theme: options.theme === 'light' ? 'light' : options.theme === 'dark' ? 'dark' : config.theme };
        }

        function project(point, centerX, centerY, size) {
            const perspective = 5 / (5 - point[2]);
            return [centerX + point[0] * size * perspective, centerY - point[1] * size * perspective];
        }

        function polygon(points) {
            context.beginPath();
            context.moveTo(points[0][0], points[0][1]);
            points.slice(1).forEach(point => context.lineTo(point[0], point[1]));
            context.closePath();
        }

        function drawDie(model, quaternion, index, x, y, size, lift) {
            const light = config.theme === 'light';
            const bodyColors = light ? [[255, 244, 213], [255, 244, 213], [255, 244, 213]] : [[52, 225, 242], [234, 108, 215], [211, 242, 85]];
            const ink = light ? ['#b73125', '#345bc0', '#338059'][index] : '#11171c';
            const edge = light ? '#34251d' : '#09232b';
            const body = bodyColors[index];
            const rotated = model.vertices.map(point => rotate(point, quaternion));
            const projected = rotated.map(point => project(point, x, y - lift, size));
            const visible = model.faces.map(face => ({
                ...face,
                rotatedNormal: rotate(face.normal, quaternion),
                rotatedCenter: rotate(face.center, quaternion)
            })).filter(face => dot(face.rotatedNormal, sub([0, 0, 5], face.rotatedCenter)) > 0.001)
                .sort((a, b) => a.rotatedCenter[2] - b.rotatedCenter[2]);

            for (const face of visible) {
                const brightness = 0.65 + 0.35 * Math.max(0, dot(face.rotatedNormal, unit([-0.5, 0.75, 1])));
                context.fillStyle = `rgb(${body.map(value => Math.round(value * brightness)).join(',')})`;
                context.strokeStyle = edge;
                context.lineWidth = light ? Math.max(2.1, size * 0.025) : Math.max(1.2, size * 0.014);
                context.lineJoin = 'round';
                polygon(face.indices.map(vertex => projected[vertex]));
                context.fill();
                context.stroke();

                const at = (u, v) => project(rotate(add(face.center, add(mul(face.u, u), mul(face.v, v))), quaternion), x, y - lift, size);
                context.fillStyle = ink;
                if (model.sides === 6) {
                    for (const [pipX, pipY] of pipLayouts[face.value]) {
                        const points = Array.from({ length: 14 }, (_, n) => {
                            const angle = n * TAU / 14;
                            return at(pipX * 0.29 + Math.cos(angle) * 0.078, pipY * 0.29 + Math.sin(angle) * 0.078);
                        });
                        polygon(points);
                        context.fill();
                    }
                } else {
                    const origin = at(0, 0);
                    const basisU = sub(at(0.1, 0), origin).map(value => value * 10);
                    const basisV = sub(at(0, 0.1), origin).map(value => value * 10);
                    context.save();
                    context.transform(basisU[0], basisU[1], -basisV[0], -basisV[1], origin[0], origin[1]);
                    context.font = `800 ${model.sides === 8 ? 0.39 : model.sides === 12 ? 0.42 : 0.26}px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif`;
                    context.textAlign = 'center';
                    context.textBaseline = 'middle';
                    context.fillText(String(face.value), 0, 0.015);
                    if (face.value === 6 || face.value === 9) {
                        context.beginPath();
                        context.arc(0, -0.20, 0.021, 0, TAU);
                        context.fill();
                    }
                    context.restore();
                }
            }
        }

        function paint(progress = 1) {
            if (destroyed || !models) return;
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            context.clearRect(0, 0, width, height);
            const model = models[config.sides];
            const size = Math.min(height * 0.28, width / (config.count === 1 ? 3.0 : config.count === 2 ? 4.6 : 6.8), 155);
            const spacing = size * 2.15;
            const centerY = height * 0.52;
            const bounce = animation && !animation.reduced ? Math.sin(Math.PI * Math.min(progress / 0.83, 1)) * size * 0.88 : 0;
            const settle = animation && !animation.reduced && progress > 0.83 ? Math.sin((progress - 0.83) / 0.17 * Math.PI) * size * 0.075 : 0;
            const lift = bounce + settle;

            for (let index = 0; index < config.count; index++) {
                const centerX = width / 2 + (index - (config.count - 1) / 2) * spacing;
                context.fillStyle = config.theme === 'light' ? `rgba(81,48,20,${0.13 - lift / size * 0.06})` : `rgba(0,229,255,${0.09 - lift / size * 0.035})`;
                context.beginPath();
                context.ellipse(centerX, centerY + size * 0.89, size * (0.70 - lift / size * 0.15), size * 0.12, 0, 0, TAU);
                context.fill();
                drawDie(model, orientations[index], index, centerX, centerY, size, lift);
            }
        }

        function cancel() {
            revision++;
            if (frame) root.cancelAnimationFrame(frame);
            frame = 0;
            animation = null;
            if (completion) { const resolve = completion; completion = null; resolve(false); }
        }

        const ready = loadModels().then(loaded => {
            models = loaded;
            if (!destroyed) {
                measure();
                orientations = values.map((value, index) => orientationForFace(models[config.sides], value, index));
                paint();
            }
        });

        function show(options = {}) {
            cancel();
            if (destroyed) return;
            settings(options);
            values = Array.from({ length: config.count }, (_, index) => options.values?.[index] || 1 + index);
            const version = revision;
            ready.then(() => {
                if (destroyed || version !== revision) return;
                measure();
                orientations = values.map((value, index) => orientationForFace(models[config.sides], value, index));
                paint();
            }).catch(() => {}); // The public ready promise exposes load failures to the app.
        }

        async function roll(options = {}) {
            cancel();
            if (destroyed) return false;
            settings(options);
            const version = revision;
            await ready;
            if (destroyed || version !== revision) return false;
            measure();
            const model = models[config.sides];
            values = Array.from({ length: config.count }, (_, index) => Math.max(1, Math.min(config.sides, Math.floor(Number(options.values?.[index]) || 1))));
            const target = values.map((value, index) => orientationForFace(model, value, index));
            const start = target.map((orientation, index) => orientations[index] || orientation);
            const reduced = !!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            const duration = reduced ? 120 : Math.max(450, Number(options.duration) || 1300);
            const started = root.performance.now();
            animation = { reduced };
            return new Promise(resolve => {
                completion = resolve;
                const tick = now => {
                    if (destroyed || revision !== version) return;
                    const progress = Math.min(1, Math.max(0, (now - started) / duration));
                    const eased = 1 - (1 - progress) ** 3;
                    orientations = target.map((orientation, index) => {
                        const base = slerp(start[index], orientation, eased);
                        if (reduced) return base;
                        const remaining = 1 - eased;
                        const spin = fromEuler(TAU * (3 + index) * remaining, TAU * (4 - index) * remaining, TAU * remaining);
                        return quaternionMultiply(spin, base);
                    });
                    paint(progress);
                    if (progress < 1) frame = root.requestAnimationFrame(tick);
                    else {
                        frame = 0;
                        animation = null;
                        completion = null;
                        resolve(true);
                        if (typeof options.onComplete === 'function') options.onComplete([...values]);
                    }
                };
                frame = root.requestAnimationFrame(tick);
            });
        }

        function resize() {
            if (destroyed) return;
            measure();
            paint(animation ? 0 : 1);
        }

        const observer = root.ResizeObserver ? new root.ResizeObserver(resize) : null;
        observer?.observe(canvas);
        root.addEventListener?.('resize', resize);
        function destroy() {
            cancel();
            destroyed = true;
            observer?.disconnect();
            root.removeEventListener?.('resize', resize);
            context.clearRect(0, 0, canvas.width, canvas.height);
        }
        return Object.freeze({ ready, show, roll, cancel, resize, destroy });
    }

    const api = { create };
    if (typeof module !== 'undefined' && module.exports) api._test = { prepareModel, orientationForFace, rotate, dot };
    return Object.freeze(api);
});
