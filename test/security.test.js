import assert from "node:assert/strict";
import test from "node:test";

import {
  createInstanceAccessKey,
  decryptCredential,
  encryptCredential,
  hashInstanceAccessKey,
  hashPassword,
  maskInstanceAccessKey,
  parseCredentialEncryptionKey,
  verifyPassword,
} from "../lib/security.js";

test("security utilities hash passwords and encrypt New API credentials", () => {
  const password = "strong-system-password";
  const passwordHash = hashPassword(password);
  assert.equal(passwordHash.includes(password), false);
  assert.equal(verifyPassword(password, passwordHash), true);
  assert.equal(verifyPassword("incorrect-password", passwordHash), false);

  const encryptionKey = Buffer.alloc(32, 7);
  const encryptedCredential = encryptCredential("new-api-admin-password", encryptionKey);
  assert.equal(encryptedCredential.includes("new-api-admin-password"), false);
  assert.equal(
    decryptCredential(encryptedCredential, encryptionKey),
    "new-api-admin-password",
  );
  assert.throws(
    () => decryptCredential(encryptedCredential, Buffer.alloc(32, 8)),
  );
});

test("credential encryption key parser accepts exact 32-byte values", () => {
  const encryptionKey = Buffer.alloc(32, 11);
  assert.deepEqual(
    parseCredentialEncryptionKey(encryptionKey.toString("base64")),
    encryptionKey,
  );
  assert.deepEqual(
    parseCredentialEncryptionKey(encryptionKey.toString("hex")),
    encryptionKey,
  );
  assert.throws(() => parseCredentialEncryptionKey("too-short"));
});

test("instance access keys are high entropy and safe to persist by digest", () => {
  const firstAccessKey = createInstanceAccessKey();
  const secondAccessKey = createInstanceAccessKey();

  assert.match(firstAccessKey, /^nai_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(firstAccessKey, secondAccessKey);
  assert.match(hashInstanceAccessKey(firstAccessKey), /^[a-f0-9]{64}$/);
  assert.notEqual(hashInstanceAccessKey(firstAccessKey), firstAccessKey);
  assert.equal(maskInstanceAccessKey(firstAccessKey).includes(firstAccessKey), false);
  assert.match(maskInstanceAccessKey(firstAccessKey), /^nai_.{4}\*{4}.{6}$/);
});
