import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(bytes: Uint8Array): string {
  let value = 0, bits = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; result += alphabet[(value >>> bits) & 31]; }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

function decodeBase32(secret: string): Buffer {
  let value = 0, bits = 0;
  const bytes: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Authenticator 密钥格式无效。');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}

export const generateTotpSecret = () => encodeBase32(randomBytes(20));

// RFC 6238, SHA-1 / 6 digits / 30 seconds, supported by Google and Microsoft Authenticator.
export function totpCode(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).toString().padStart(digits, '0');
}

export function verifyTotp(secret: string, code: string, now: number, lastStep = -1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30_000);
  for (const step of [current, current - 1, current + 1]) {
    if (step < 0 || step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(code), Buffer.from(totpCode(secret, step)))) return step;
  }
  return null;
}

export function authenticatorUri(secret: string, username: string): string {
  const issuer = '轻剪';
  const parameters = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${username}`)}?${parameters}`;
}
