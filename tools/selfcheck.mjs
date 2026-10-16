// Self-check: wyhash port fidelity + derivation determinism.
// Hash vectors below were verified against Bun.hash (bun 1.3.14) on 2026-10-15.
import { createRequire } from 'module';
import assert from 'assert';
const require = createRequire(import.meta.url);
const { hashString } = require('./wyhash.js');

const VECTORS = {
  '': 290873116282709081n,
  'friend-2026-401': 13861612982587048974n,
};
assert.strictEqual(hashString(''), 290873116282709081n, 'empty-string wyhash vector');

// determinism: same id -> same bones-relevant seed, different ids differ
const seed = (id) => Number(hashString(id + 'friend-2026-401') & 0xffffffffn);
assert.strictEqual(seed('test-account-uuid'), seed('test-account-uuid'));
assert.notStrictEqual(seed('a'), seed('b'));
console.log('selfcheck OK');
