// Pure-JS port of zig std.hash.Wyhash (what Bun.hash uses), seed 0.
// Ported from ziglang lib/std/hash/wyhash.zig; verified against Bun.hash locally.
'use strict';

const M = 0xffffffffffffffffn;
const S0 = 0xa0761d6478bd642fn;
const S1 = 0xe7037ed1a0b428dbn;
const S2 = 0x8ebc6af09c88c6e3n;
const S3 = 0x589965cc75374cc3n;

// mix(a,b) = lo ^ hi of the 128-bit product
function mix(a, b) {
  const r = (a & M) * (b & M);
  return ((r >> 64n) ^ r) & M;
}

function r8(buf, i) {
  let v = 0n;
  for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(buf[i + k]);
  return v;
}
function r4(buf, i) {
  return BigInt(buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16)) | (BigInt(buf[i + 3]) << 24n);
}

function wyhash(bytes, seed = 0n) {
  const len = bytes.length;
  let state = (seed ^ mix(seed ^ S0, S1)) & M;
  let a = 0n, b = 0n;

  if (len <= 16) {
    if (len >= 4) {
      const end = len - 4;
      const quarter = (len >> 3) << 2;
      a = ((r4(bytes, 0) << 32n) | r4(bytes, quarter)) & M;
      b = ((r4(bytes, end) << 32n) | r4(bytes, end - quarter)) & M;
    } else if (len > 0) {
      a = (BigInt(bytes[0]) << 16n) | (BigInt(bytes[len >> 1]) << 8n) | BigInt(bytes[len - 1]);
      b = 0n;
    }
  } else {
    let i = 0;
    if (len >= 48) {
      let s0 = state, s1 = state, s2 = state;
      while (i + 48 < len) {
        s0 = mix(r8(bytes, i) ^ S1, r8(bytes, i + 8) ^ s0);
        s1 = mix(r8(bytes, i + 16) ^ S2, r8(bytes, i + 24) ^ s1);
        s2 = mix(r8(bytes, i + 32) ^ S3, r8(bytes, i + 40) ^ s2);
        i += 48;
      }
      state = (s0 ^ s1 ^ s2) & M;
    }
    while (i + 16 < len) {
      state = mix(r8(bytes, i) ^ S1, r8(bytes, i + 8) ^ state);
      i += 16;
    }
    a = r8(bytes, len - 16);
    b = r8(bytes, len - 8);
  }

  a = (a ^ S1) & M;
  b = (b ^ state) & M;
  const r = (a & M) * (b & M); // mum: a=lo, b=hi
  a = r & M;
  b = (r >> 64n) & M;
  return mix(a ^ S0 ^ BigInt(len), b ^ S1);
}

function hashString(s) {
  return wyhash(Buffer.from(s, 'utf8'));
}

module.exports = { wyhash, hashString };

if (require.main === module) {
  console.log(hashString(process.argv[2] ?? '').toString());
}
