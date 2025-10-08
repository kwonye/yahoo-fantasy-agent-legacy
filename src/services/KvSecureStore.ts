/**
 * @fileoverview A secure store implementation using a key-value (KV) store backend,
 * such as Vercel KV or Upstash Redis, for persistent, encrypted storage.
 */
import crypto from 'crypto';
import request from 'sync-request';
import { SecureStore } from './SecureStore';

/**
 * @interface KvSecureStoreOptions
 * @description Options for configuring the KvSecureStore.
 * @property {string} baseUrl - The base URL of the KV store's REST API.
 * @property {string} token - The authentication token for the KV store.
 * @property {string} encryptionKey - The secret key used for AES-256-GCM encryption.
 * @property {string} [prefix] - A prefix for all keys stored in the KV store.
 * @property {number} [timeoutMs] - The timeout in milliseconds for API requests.
 */
export interface KvSecureStoreOptions {
  baseUrl: string;
  token: string;
  encryptionKey: string;
  prefix?: string;
  timeoutMs?: number;
}

/**
 * @private
 * @typedef {object} Payload
 * @description The structure of the encrypted data stored in the KV store.
 * @property {number} v - The version of the payload schema.
 * @property {string} iv - The initialization vector used for encryption, in base64.
 * @property {string} tag - The authentication tag from the GCM cipher, in base64.
 * @property {string} data - The encrypted data, in base64.
 */
type Payload = {
  v: number;
  iv: string;
  tag: string;
  data: string;
};

/**
 * @class KvSecureStore
 * @description Implements a secure storage mechanism using a remote KV store.
 * It encrypts data client-side before sending it to the store and decrypts it upon retrieval.
 * This class is compatible with the `ConfigStore` interface.
 */
export class KvSecureStore {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly key: Buffer;
  private readonly prefix: string;
  private readonly timeoutMs: number;

  /**
   * @constructor
   * @param {KvSecureStoreOptions} options - Configuration options for the store.
   * @throws {Error} If the base URL or token is missing.
   */
  constructor(options: KvSecureStoreOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.prefix = options.prefix ?? 'yahoo-fantasy-agent';
    this.timeoutMs = options.timeoutMs ?? 4000;
    if (!this.baseUrl || !this.token) {
      throw new Error('KV base URL or token missing');
    }
    this.key = SecureStore.normalizeKey(options.encryptionKey);
  }

  /**
   * @method save
   * @description Encrypts and saves data to the KV store under a specified name.
   * @template T - The type of data being saved.
   * @param {string} name - The name (key) to store the data under.
   * @param {T} data - The data to save.
   */
  save<T>(name: string, data: T): void {
    const payload = this.encryptPayload(data);
    const encodedValue = this.encodePayload(payload);
    const path = `set/${this.encodeKey(name)}/${encodedValue}`;
    this.call('POST', path);
  }

  /**
   * @method load
   * @description Loads and decrypts data from the KV store.
   * @template T - The expected type of the loaded data.
   * @param {string} name - The name (key) of the data to load.
   * @returns {T | null} The decrypted data, or null if not found.
   */
  load<T>(name: string): T | null {
    const path = `get/${this.encodeKey(name)}`;
    const res = this.call('GET', path, true);
    if (!res) return null;
    const payload = this.decodePayload(res);
    return this.decryptPayload(payload) as T;
  }

  /**
   * @method remove
   * @description Deletes an item from the KV store.
   * @param {string} name - The name (key) of the item to delete.
   */
  remove(name: string): void {
    const path = `del/${this.encodeKey(name)}`;
    this.call('POST', path, true);
  }

  /**
   * @private
   * @method encodeKey
   * @description Encodes a key name with the configured prefix for storage.
   * @param {string} name - The raw key name.
   * @returns {string} The encoded key.
   */
  private encodeKey(name: string): string {
    const key = `${this.prefix}:${name}`;
    return encodeURIComponent(key);
  }

  /**
   * @private
   * @method encryptPayload
   * @description Encrypts data using AES-256-GCM.
   * @template T - The type of the data.
   * @param {T} data - The plaintext data.
   * @returns {Payload} The encrypted payload.
   */
  private encryptPayload<T>(data: T): Payload {
    const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      v: 1,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: ciphertext.toString('base64'),
    };
  }

  /**
   * @private
   * @method decryptPayload
   * @description Decrypts a payload using AES-256-GCM.
   * @param {Payload} payload - The encrypted payload.
   * @returns {unknown} The decrypted data.
   */
  private decryptPayload(payload: Payload): unknown {
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const ciphertext = Buffer.from(payload.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  }

  /**
   * @private
   * @method encodePayload
   * @description Encodes an encrypted payload for safe transport in a URL.
   * @param {Payload} payload - The payload to encode.
   * @returns {string} The URL-safe encoded payload.
   */
  private encodePayload(payload: Payload): string {
    const json = JSON.stringify(payload);
    const base64 = Buffer.from(json, 'utf8').toString('base64');
    return encodeURIComponent(base64);
  }

  /**
   * @private
   * @method decodePayload
   * @description Decodes a raw string from the KV store into a payload object.
   * @param {string} raw - The raw, base64-encoded string.
   * @returns {Payload} The decoded payload object.
   */
  private decodePayload(raw: string): Payload {
    const json = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(json) as Payload;
  }

  /**
   * @private
   * @method call
   * @description Makes a synchronous HTTP request to the KV store API.
   * @param {string} method - The HTTP method.
   * @param {string} path - The API path.
   * @param {boolean} [allowMissing=false] - Whether to treat a 404 error as a non-error (for load/remove operations).
   * @returns {string | null} The result from the API response, or null.
   * @throws {Error} If the API request fails with a non-404 status or if the response is malformed.
   */
  private call(
    method:
      | 'GET'
      | 'POST'
      | 'PUT'
      | 'DELETE'
      | 'HEAD'
      | 'OPTIONS'
      | 'PATCH'
      | 'CONNECT'
      | 'TRACE',
    path: string,
    allowMissing = false,
  ): string | null {
    const url = `${this.baseUrl}/${path}`;
    const response = request(method, url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      timeout: this.timeoutMs,
    });
    const status = (response as any).statusCode as number;
    const body = response.getBody('utf8');
    if (status >= 400) {
      if (allowMissing && status === 404) return null;
      const snippet = body.length > 200 ? `${body.slice(0, 200)}...` : body;
      throw new Error(`KV request failed (${status}): ${snippet}`);
    }
    if (!body) return null;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.result === 'string') {
        return parsed.result as string;
      }
      if (parsed && parsed.result == null) {
        return null;
      }
    } catch {
      if (allowMissing) return null;
      throw new Error('KV response parse error');
    }
    return null;
  }
}
