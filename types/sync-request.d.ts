declare module 'sync-request' {
  import { IncomingHttpHeaders } from 'http';

  export interface SyncRequestOptions {
    headers?: Record<string, string>;
    qs?: Record<string, string | number | boolean>;
    timeout?: number;
    body?: string | Buffer;
  }

  export interface SyncResponse {
    statusCode: number;
    headers: IncomingHttpHeaders;
    getBody(encoding?: BufferEncoding): string;
  }

  export default function request(method: string, url: string, options?: SyncRequestOptions): SyncResponse;
}
