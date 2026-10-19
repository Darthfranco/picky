(function (root, factory) {
    const rules = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = rules;
    else root.PickyPartyRules = rules;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function checkItems(items) {
        if (!Array.isArray(items)) throw new TypeError('Players must be an array.');
    }

    // randomInt(bound) returns an integer from 0 through bound - 1.
    // Inputs and player objects are never changed by these helpers.
    function shuffle(items, randomInt) {
        checkItems(items);
        if (typeof randomInt !== 'function') throw new TypeError('A random integer function is required.');
        const result = items.slice();
        for (let last = result.length - 1; last > 0; last--) {
            const selected = randomInt(last + 1);
            if (!Number.isInteger(selected) || selected < 0 || selected > last) {
                throw new RangeError('Random integer is outside its requested range.');
            }
            [result[last], result[selected]] = [result[selected], result[last]];
        }
        return result;
    }

    function partition(items, count) {
        const size = Math.floor(items.length / count);
        const remainder = items.length % count;
        let offset = 0;
        return Array.from({ length: count }, (_, index) => {
            const end = offset + size + (index < remainder ? 1 : 0);
            const group = items.slice(offset, end);
            offset = end;
            return group;
        });
    }

    // Return exactly teamCount teams; any remainder is spread one per team.
    function balancedTeams(items, teamCount, randomInt) {
        checkItems(items);
        if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 5) {
            throw new RangeError('Choose between 2 and 5 teams.');
        }
        if (items.length < teamCount || items.length > teamCount * 4) {
            throw new RangeError('Each team needs between 1 and 4 players.');
        }
        return partition(shuffle(items, randomInt), teamCount);
    }

    // Ordered by rank: [{ player: originalItem, rank: 1 }, ...].
    function rankPlayers(items, randomInt) {
        return shuffle(items, randomInt).map((player, index) => ({ player, rank: index + 1 }));
    }

    // Preserve entrants' order. The smallest number of balanced batches avoids
    // singleton byes whenever possible. Reapply to each round's winners.
    function tournamentBatches(items, maxSize = 5) {
        checkItems(items);
        if (!Number.isInteger(maxSize) || maxSize < 2) {
            throw new RangeError('A tournament batch must allow at least 2 players.');
        }
        if (!items.length) return [];
        return partition(items, Math.ceil(items.length / maxSize));
    }

    return Object.freeze({ shuffle, balancedTeams, rankPlayers, tournamentBatches });
});
