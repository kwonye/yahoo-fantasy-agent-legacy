import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface SecureStoreOptions {
  baseDir: string;
  encryptionKey: string; // 32-byte key in hex or base64 or raw
}

export class SecureStore {
  private readonly baseDir: string;
  private readonly key: Buffer;

  constructor(options: SecureStoreOptions) {
    this.baseDir = options.baseDir;
    this.key = SecureStore.normalizeKey(options.encryptionKey);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

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

  private filePath(name: string): string {
    return path.join(this.baseDir, `${name}.enc.json`);
  }

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

  remove(name: string): void {
    const fp = this.filePath(name);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
  }
}
