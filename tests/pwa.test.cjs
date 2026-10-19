const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appDirectory = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(appDirectory, 'service-worker.js'), 'utf8');
const registrationSource = fs.readFileSync(path.join(appDirectory, 'pwa.js'), 'utf8');

function createStorage() {
    const entries = new Map();
    return {
        async open(name) {
            if (!entries.has(name)) entries.set(name, new Map());
            return entries.get(name);
        },
        async keys() { return [...entries.keys()]; },
        async delete(name) { return entries.delete(name); }
    };
}

function createWorker({ scope, storage = createStorage(), release = 'first', source = workerSource } = {}) {
    const listeners = new Map();
    const network = { offline: false, missing: null, requests: [] };
    let claimed = false;
    const fetch = async request => {
        const url = typeof request === 'string' ? request : request.url;
        network.requests.push(request);
        if (network.offline) throw new TypeError('Offline');
        if (url === network.missing) return new Response('Missing', { status: 404 });
        const relativePath = decodeURIComponent(url.slice(scope.length));
        assert.ok(fs.existsSync(path.join(appDirectory, relativePath)), `Missing shell file: ${relativePath}`);
        return new Response(`${release}:${relativePath}`);
    };
    vm.runInNewContext(source, {
        URL, Request, Set, fetch,
        caches: {
            keys: () => storage.keys(),
            delete: name => storage.delete(name),
            async open(name) {
                const entries = await storage.open(name);
                return {
                    // Cache.addAll commits only if every response succeeds.
                    async addAll(requests) {
                        const responses = await Promise.all(requests.map(fetch));
                        if (responses.some(response => !response.ok)) throw new TypeError('Precache failed');
                        requests.forEach((request, i) => entries.set(request.url, responses[i]));
                    },
                    async match(url) { return entries.get(url)?.clone(); }
                };
            }
        },
        self: {
            registration: { scope },
            clients: { async claim() { claimed = true; } },
            skipWaiting() { assert.fail('An update must not interrupt active app windows'); },
            addEventListener(type, listener) { listeners.set(type, listener); }
        }
    });
    return {
        network, storage,
        get claimed() { return claimed; },
        async lifecycle(type) {
            let promise;
            listeners.get(type)({ waitUntil(value) { promise = value; } });
            await promise;
        },
        async request(relativePath = '', options = {}) {
            let promise;
            listeners.get('fetch')({
                request: { url: new URL(relativePath, scope).href, method: 'GET', mode: 'same-origin', ...options },
                respondWith(value) { promise = value; }
            });
            return promise;
        }
    };
}

for (const mount of ['/', '/Picky/']) {
    test(`complete app opens from cache offline and without waiting for network at ${mount}`, async () => {
        const scope = `https://example.test${mount}`;
        const worker = createWorker({ scope });
        await worker.lifecycle('install');
        assert.equal(worker.claimed, false);
        assert.ok(worker.network.requests.every(request => request.cache === 'reload'));
        const installedRequests = [...worker.network.requests];
        await worker.lifecycle('activate');
        assert.equal(worker.claimed, true);
        worker.network.offline = true;
        const navigation = await worker.request('?source=installed', { mode: 'navigate' });
        assert.equal(await navigation.text(), 'first:index.html');
        for (const request of installedRequests) {
            const response = await worker.request(`${request.url}?version=ignored`);
            assert.equal(await response.text(), `first:${request.url.slice(scope.length)}`);
        }
        assert.equal(worker.network.requests.length, installedRequests.length, 'Cached launches must make no shell network requests');
        assert.equal(await worker.request('other-file.js'), undefined);
        assert.equal(await worker.request('index.html', { method: 'POST' }), undefined);
        assert.equal(await worker.request('https://other.test/index.html'), undefined);
    });
}

test('a complete update waits; failed downloads preserve the installed version; activation cleans only this app scope', async () => {
    const scope = 'https://example.test/Picky/';
    const first = createWorker({ scope });
    await first.lifecycle('install');
    await first.lifecycle('activate');
    const [firstCache] = await first.storage.keys();
    await first.storage.open('unrelated-app');
    await first.storage.open('picky:https://example.test/:old');

    const second = createWorker({
        scope, storage: first.storage, release: 'second',
        source: workerSource.replace(/const CACHE_VERSION = '[^']+';/, "const CACHE_VERSION = 'second';")
    });
    await second.lifecycle('install');
    assert.equal(second.claimed, false);
    assert.ok((await first.storage.keys()).includes(firstCache));
    assert.equal(await (await first.request('', { mode: 'navigate' })).text(), 'first:index.html');

    const failed = createWorker({
        scope, storage: first.storage, release: 'failed',
        source: workerSource.replace(/const CACHE_VERSION = '[^']+';/, "const CACHE_VERSION = 'failed';")
    });
    failed.network.missing = `${scope}color-palette.js`;
    await assert.rejects(failed.lifecycle('install'), /Precache failed/);
    first.network.offline = true;
    assert.equal(await (await first.request('', { mode: 'navigate' })).text(), 'first:index.html');

    await second.lifecycle('activate');
    second.network.offline = true;
    assert.equal(await (await second.request('', { mode: 'navigate' })).text(), 'second:index.html');
    assert.deepEqual((await first.storage.keys()).sort(), [
        'unrelated-app', 'picky:https://example.test/:old', `${firstCache.slice(0, firstCache.lastIndexOf(':') + 1)}second`
    ].sort());
});

test('registration starts after load and resolves the worker relative to its own script', async () => {
    const listeners = new Map();
    const registrations = [];
    vm.runInNewContext(registrationSource, {
        URL,
        navigator: { serviceWorker: { register(...args) { registrations.push(args); return Promise.reject(new TypeError('Offline')); } } },
        document: { currentScript: { src: 'https://example.test/Picky/pwa.js' }, readyState: 'loading' },
        window: { isSecureContext: true, addEventListener(type, listener) { listeners.set(type, listener); } }
    });
    assert.equal(registrations.length, 0);
    listeners.get('load')();
    await Promise.resolve();
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0][0], 'https://example.test/Picky/service-worker.js');
    assert.equal(registrations[0][1].scope, 'https://example.test/Picky/');
    assert.equal(registrations[0][1].updateViaCache, 'none');
});

test('both manifests resolve install URLs and icons correctly at root and nested hosting paths', () => {
    for (const mount of ['/', '/Picky/']) {
        const scope = `https://example.test${mount}`;
        for (const file of ['manifest.json', 'images/site.webmanifest']) {
            const manifestURL = new URL(file, scope);
            const manifest = JSON.parse(fs.readFileSync(path.join(appDirectory, file), 'utf8'));
            for (const field of ['id', 'start_url', 'scope']) {
                assert.equal(new URL(manifest[field], manifestURL).href, scope);
            }
            for (const icon of manifest.icons) {
                const iconURL = new URL(icon.src, manifestURL);
                assert.ok(iconURL.href.startsWith(scope));
                assert.ok(fs.existsSync(path.join(appDirectory, iconURL.href.slice(scope.length))));
            }
        }
    }
});
