(() => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

    const workerURL = new URL('service-worker.js', document.currentScript.src);

    const register = () => {
        // Registration checks for a newer worker in the background. Normal
        // launches keep using the installed cache, including without Wi-Fi.
        navigator.serviceWorker.register(workerURL.href, {
            scope: new URL('./', workerURL).href,
            updateViaCache: 'none'
        }).catch(() => {
            // Offline starts and failed updates must not affect gameplay.
            // An existing installed worker and its cache remain available.
        });
    };

    if (document.readyState === 'complete') {
        register();
    } else {
        window.addEventListener('load', register, { once: true });
    }
})();
