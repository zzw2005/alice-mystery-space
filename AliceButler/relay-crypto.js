'use strict';
// Shared end-to-end encryption for the pet relay: AES-256-GCM.
// The relay server only ever sees ciphertext; the key lives only on the
// PC (AliceButler) and on Alice's VM.
const crypto = require('crypto');

function loadKey(hex) {
  const key = Buffer.from(String(hex || '').trim(), 'hex');
  if (key.length !== 32) throw new Error('relay e2e key must be 32 bytes hex');
  return key;
}

// encrypt(utf8 string) -> base64( iv[12] | tag[16] | ciphertext )
function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString('base64');
}

// decrypt(base64) -> utf8 string; throws on tamper / wrong key
function decrypt(key, b64) {
  const raw = Buffer.from(String(b64), 'base64');
  if (raw.length < 29) throw new Error('ciphertext too short');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

module.exports = { loadKey, encrypt, decrypt };
