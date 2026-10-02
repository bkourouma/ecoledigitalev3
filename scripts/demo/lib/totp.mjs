/** TOTP (RFC 6238, SHA-1, 6 chiffres, pas de 30 s) : code courant d'un compte de démonstration. */
import { createHmac } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("secret TOTP invalide");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpAt(secret, timeMs = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 0x0f;
  const code = ((mac[o] & 0x7f) << 24) | ((mac[o + 1] & 0xff) << 16) | ((mac[o + 2] & 0xff) << 8) | (mac[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function secondsLeft(timeMs = Date.now()) {
  return 30 - (Math.floor(timeMs / 1000) % 30);
}
