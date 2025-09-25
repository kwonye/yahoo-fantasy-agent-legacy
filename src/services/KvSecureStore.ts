import crypto from 'crypto';
import request from 'sync-request';
import { SecureStore } from './SecureStore';

export interface KvSecureStoreOptions {
  baseUrl: string;
  token: string;
  encryptionKey: string;
  prefix?: string;
  timeoutMs?: number;
}

type Payload = {
  v: number;
  iv: string;
  tag: string;
  data: string;
};

export class KvSecureStore {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly key: Buffer;
  private readonly prefix: string;
  private readonly timeoutMs: number;

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

  save<T>(name: string, data: T): void {
    const payload = this.encryptPayload(data);
    const encodedValue = this.encodePayload(payload);
    const path = `set/${this.encodeKey(name)}/${encodedValue}`;
    this.call('POST', path);
  }

  load<T>(name: string): T | null {
    const path = `get/${this.encodeKey(name)}`;
    const res = this.call('GET', path, true);
    if (!res) return null;
    const payload = this.decodePayload(res);
    return this.decryptPayload(payload) as T;
  }

  remove(name: string): void {
    const path = `del/${this.encodeKey(name)}`;
    this.call('POST', path, true);
  }

  private encodeKey(name: string): string {
    const key = `${this.prefix}:${name}`;
    return encodeURIComponent(key);
  }

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

  private decryptPayload(payload: Payload): unknown {
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const ciphertext = Buffer.from(payload.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  }

  private encodePayload(payload: Payload): string {
    const json = JSON.stringify(payload);
    const base64 = Buffer.from(json, 'utf8').toString('base64');
    return encodeURIComponent(base64);
  }

  private decodePayload(raw: string): Payload {
    const json = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(json) as Payload;
  }

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
