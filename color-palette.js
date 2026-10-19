const PickyColors = (() => {
    // Give small games five distinct hues before introducing neighboring shades.
    const primaryColors = Object.freeze(['#00E5FF', '#FF00FF', '#76FF03', '#FF9100', '#5C5CFF']);
    const palette = Object.freeze([
        ...primaryColors,
        '#FF1744', '#FFFF00', '#D500F9', '#00B0FF', '#1DE9B6'
    ]);

    function toOklab(hex) {
        const linear = [1, 3, 5].map(offset => {
            const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        const [r, g, b] = linear;
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        return [
            0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
        ];
    }

    const perceptualColors = new Map(palette.map(color => [color, toOklab(color)]));

    function distance(first, second) {
        const a = perceptualColors.get(first) || toOklab(first);
        const b = perceptualColors.get(second) || toOklab(second);
        return Math.hypot(...a.map((value, index) => value - b[index]));
    }

    function selectColor(available, active) {
        const unused = available.filter(color => !active.includes(color));
        const distinct = unused.filter(color => primaryColors.includes(color));
        const candidates = distinct.length ? distinct : unused;
        if (!active.length) return candidates[0];

        // Keep existing fingers stable and maximize the new color's separation
        // from its closest active neighbor, rather than comparing only the last two.
        let selected;
        let bestDistance = -1;
        for (const candidate of candidates) {
            const nearest = Math.min(...active.map(color => distance(candidate, color)));
            if (nearest > bestDistance) {
                selected = candidate;
                bestDistance = nearest;
            }
        }
        return selected;
    }

    return Object.freeze({ palette, selectColor });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PickyColors;
