import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const PASSWORD_HASH_PREFIX = "scrypt";
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 64;
const CREDENTIAL_INITIALIZATION_VECTOR_BYTES = 12;
const CREDENTIAL_AUTHENTICATION_TAG_BYTES = 16;
const INSTANCE_ACCESS_KEY_BYTES = 32;
const INSTANCE_ACCESS_KEY_PREFIX = "nai_";

function createSha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function hashPassword(password) {
  const normalizedPassword = String(password);
  if (normalizedPassword.length < 10) {
    throw new Error("系统用户密码至少需要 10 个字符");
  }
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const derivedPassword = scryptSync(normalizedPassword, salt, PASSWORD_HASH_BYTES);
  return [
    PASSWORD_HASH_PREFIX,
    salt.toString("base64url"),
    derivedPassword.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password, storedPasswordHash) {
  const [prefix, encodedSalt, encodedHash] = String(storedPasswordHash).split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !encodedSalt || !encodedHash) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expectedHash = Buffer.from(encodedHash, "base64url");
    const actualHash = scryptSync(String(password), salt, expectedHash.length);
    return expectedHash.length === actualHash.length
      && timingSafeEqual(expectedHash, actualHash);
  } catch {
    return false;
  }
}

export function parseCredentialEncryptionKey(rawEncryptionKey) {
  const normalizedEncryptionKey = String(rawEncryptionKey || "").trim();
  let encryptionKey;

  if (/^[a-f0-9]{64}$/i.test(normalizedEncryptionKey)) {
    encryptionKey = Buffer.from(normalizedEncryptionKey, "hex");
  } else {
    try {
      encryptionKey = Buffer.from(normalizedEncryptionKey, "base64");
    } catch {
      encryptionKey = Buffer.alloc(0);
    }
  }

  if (encryptionKey.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY 必须是 32 字节 Base64 或 64 位十六进制值");
  }
  return encryptionKey;
}

export function encryptCredential(plaintext, encryptionKey) {
  const initializationVector = randomBytes(CREDENTIAL_INITIALIZATION_VECTOR_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, initializationVector);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();
  return Buffer.concat([
    initializationVector,
    authenticationTag,
    ciphertext,
  ]).toString("base64url");
}

export function decryptCredential(encryptedCredential, encryptionKey) {
  const encryptedBytes = Buffer.from(String(encryptedCredential), "base64url");
  const minimumLength = CREDENTIAL_INITIALIZATION_VECTOR_BYTES
    + CREDENTIAL_AUTHENTICATION_TAG_BYTES;
  if (encryptedBytes.length < minimumLength) {
    throw new Error("New API 凭据密文无效");
  }

  const initializationVector = encryptedBytes.subarray(
    0,
    CREDENTIAL_INITIALIZATION_VECTOR_BYTES,
  );
  const authenticationTag = encryptedBytes.subarray(
    CREDENTIAL_INITIALIZATION_VECTOR_BYTES,
    minimumLength,
  );
  const ciphertext = encryptedBytes.subarray(minimumLength);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, initializationVector);
  decipher.setAuthTag(authenticationTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(sessionToken) {
  return createSha256(sessionToken);
}

export function createInstanceAccessKey() {
  return `${INSTANCE_ACCESS_KEY_PREFIX}${randomBytes(INSTANCE_ACCESS_KEY_BYTES).toString("base64url")}`;
}

export function hashInstanceAccessKey(accessKey) {
  return createSha256(accessKey);
}

export function maskInstanceAccessKey(accessKey) {
  const normalizedAccessKey = String(accessKey);
  return `${normalizedAccessKey.slice(0, 8)}****${normalizedAccessKey.slice(-6)}`;
}
