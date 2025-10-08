/**
 * @fileoverview A class for securely storing and retrieving sensitive data
 * by encrypting it and saving it to the local file system.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * @interface SecureStoreOptions
 * @description Options for configuring the SecureStore.
 * @property {string} baseDir - The base directory where encrypted files will be stored.
 * @property {string} encryptionKey - The secret key used for encryption. Can be a raw string, hex, or base64.
 */
export interface SecureStoreOptions {
  baseDir: string;
  encryptionKey: string; // 32-byte key in hex or base64 or raw
}

/**
 * @class SecureStore
 * @description Provides methods to save, load, and remove data securely.
 * Data is encrypted using AES-256-GCM before being written to a file.
 */
export class SecureStore {
  private readonly baseDir: string;
  private readonly key: Buffer;

  /**
   * @constructor
   * @param {SecureStoreOptions} options - The configuration options for the secure store.
   */
  constructor(options: SecureStoreOptions) {
    this.baseDir = options.baseDir;
    this.key = SecureStore.normalizeKey(options.encryptionKey);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * @static
   * @method normalizeKey
   * @description Normalizes a user-provided key string into a 32-byte buffer suitable for AES-256.
   * It accepts hex, base64, or raw strings and uses SHA-256 to ensure the correct length.
   * @param {string} input - The raw encryption key string.
   * @returns {Buffer} A 32-byte buffer representing the encryption key.
   */
  static normalizeKey(input: string): Buffer {
    // Accept hex, base64, or raw string; generate a 32-byte key via HKDF if needed
    let buf: Buffer;
    try {
      if (/^[0-9a-fA-F]{64}$/.test(input)) {
        buf = Buffer.from(input, 'hex');
      } else if (/^[A-Za-z0-9+/=]+$/.test(input) && Buffer.from(input, 'base64').length >= 32) {
        const b = Buffer.from(input, 'base64');
        buf = b.length === 32 ? b : crypto.createHash('sha256').update(b).digest();
      } else {
        buf = crypto.createHash('sha256').update(input).digest();
      }
    } catch {
      buf = crypto.createHash('sha256').update(input).digest();
    }
    if (buf.length !== 32) {
      buf = crypto.createHash('sha256').update(buf).digest();
    }
    return buf;
  }

  /**
   * @private
   * @method filePath
   * @description Generates the full file path for a given data name.
   * @param {string} name - The name of the data item.
   * @returns {string} The full path to the encrypted file.
   */
  private filePath(name: string): string {
    return path.join(this.baseDir, `${name}.enc.json`);
  }

  /**
   * @method save
   * @description Encrypts and saves data to a file.
   * @template T - The type of the data being saved.
   * @param {string} name - The name to store the data under.
   * @param {T} data - The data to save.
   */
  save<T>(name: string, data: T): void {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = {
      v: 1,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: ciphertext.toString('base64'),
    };
    fs.writeFileSync(this.filePath(name), JSON.stringify(payload, null, 2), { encoding: 'utf8' });
  }

  /**
   * @method load
   * @description Loads and decrypts data from a file.
   * @template T - The expected type of the loaded data.
   * @param {string} name - The name of the data to load.
   * @returns {T | null} The decrypted data, or null if the file does not exist.
   */
  load<T>(name: string): T | null {
    const fp = this.filePath(name);
    if (!fs.existsSync(fp)) return null;
    const payload = JSON.parse(fs.readFileSync(fp, 'utf8')) as {
      v: number;
      iv: string;
      tag: string;
      data: string;
    };
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const ciphertext = Buffer.from(payload.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  }

  /**
   * @method remove
   * @description Deletes a securely stored file.
   * @param {string} name - The name of the data to remove.
   */
  remove(name: string): void {
    const fp = this.filePath(name);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
  }
}
