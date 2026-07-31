/**
 * API Key 加密工具——从 backend/utils/crypto.ts 迁移
 *
 * 用于 ModelConfigService 加密存储 API Key。
 * 使用 AES-256-GCM 算法，密钥从环境变量 AGG_ENCRYPTION_KEY 或机器标识派生。
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

const ENV_KEY = process.env.AGG_ENCRYPTION_KEY || '';

function getEncryptionKey(): Buffer {
  if (ENV_KEY) {
    return scryptSync(ENV_KEY, 'agg-salt-fixed', KEY_LENGTH);
  }
  const machineId = process.env.COMPUTERNAME
    || process.env.USERNAME
    || process.env.USER
    || 'default-machine';
  return scryptSync(machineId, 'agg-salt-fixed', KEY_LENGTH);
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return `enc:v1:${combined.toString('base64')}`;
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith('enc:v1:')) {
    return ciphertext;
  }
  const key = getEncryptionKey();
  const combined = Buffer.from(ciphertext.slice(7), 'base64');
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export function isEncrypted(value: string): boolean {
  return value.startsWith('enc:v1:');
}
