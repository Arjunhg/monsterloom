/**
 * ChallengeLink (task 22.1, Req 28.3, 28.5, 28.6): compact encoding of a
 * friend-challenge payload `{ v: 1, seed, score, name? ≤ 16 chars }`.
 *
 * Binary layout (little-endian), then CRC8, then base64url (no padding):
 *   byte 0      version (1)
 *   bytes 1–4   seed uint32
 *   bytes 5–8   score uint32
 *   byte 9      name byte length N (UTF-8, 0 = no name)
 *   bytes 10..  name bytes (N)
 *   last byte   CRC8 (poly 0x07, init 0x00) over all preceding bytes
 *
 * The encoded string travels as the `challenge` share/launch parameter.
 * `decode` returns null on any malformed input and never throws.
 */
export interface ChallengePayload {
  v: 1;
  seed: number;
  score: number;
  name?: string;
}

const VERSION = 1;
const MAX_NAME_CHARS = 16;
const HEADER_BYTES = 10; // version + seed + score + name length

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function crc8(bytes: Uint8Array, end: number): number {
  let crc = 0;
  for (let i = 0; i < end; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += BASE64_ALPHABET[b2 & 0x3f];
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlToBytes(text: string): Uint8Array | null {
  if (!BASE64URL_RE.test(text)) return null;
  const clean = text.replace(/-/g, '+').replace(/_/g, '/');
  // A length of 1 mod 4 can never be valid base64.
  if (clean.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const value = BASE64_ALPHABET.indexOf(ch);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function sanitizeUint32(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(0xffffffff, Math.max(0, Math.floor(v))) >>> 0;
}

/** Trimmed, capped at 16 code points; empty after trimming means no name. */
function sanitizeName(name: string | undefined): string | undefined {
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  return [...trimmed].slice(0, MAX_NAME_CHARS).join('');
}

/** Encodes a payload to a base64url challenge code. Out-of-range fields are sanitized. */
export function encodeChallenge(payload: ChallengePayload): string {
  const name = sanitizeName(payload.name);
  const nameBytes = name ? new TextEncoder().encode(name) : new Uint8Array(0);
  const bytes = new Uint8Array(HEADER_BYTES + nameBytes.length + 1);
  bytes[0] = VERSION;
  writeUint32LE(bytes, 1, sanitizeUint32(payload.seed));
  writeUint32LE(bytes, 5, sanitizeUint32(payload.score));
  bytes[9] = nameBytes.length;
  bytes.set(nameBytes, HEADER_BYTES);
  bytes[bytes.length - 1] = crc8(bytes, bytes.length - 1);
  return bytesToBase64Url(bytes);
}

/** Decodes a challenge code. Returns null on ANY malformed input; never throws. */
export function decodeChallenge(code: unknown): ChallengePayload | null {
  try {
    if (typeof code !== 'string' || code.length === 0) return null;
    const bytes = base64UrlToBytes(code);
    if (!bytes || bytes.length < HEADER_BYTES + 1) return null;
    if (bytes[0] !== VERSION) return null;
    const nameLength = bytes[9];
    if (bytes.length !== HEADER_BYTES + nameLength + 1) return null;
    if (crc8(bytes, bytes.length - 1) !== bytes[bytes.length - 1]) return null;
    const seed = readUint32LE(bytes, 1);
    const score = readUint32LE(bytes, 5);
    if (nameLength === 0) return { v: 1, seed, score };
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + nameLength));
    if (!name || [...name].length > MAX_NAME_CHARS) return null;
    return { v: 1, seed, score, name };
  } catch {
    return null;
  }
}
