import request from 'supertest';
import { startServer } from '../../src/web/server';
import http from 'http';

describe('Web server', () => {
  let server: http.Server;
  beforeAll(async () => {
    server = await startServer(0); // use ephemeral port
  });
  afterAll((done) => {
    server.close(done);
  });

  it('health returns ok', async () => {
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('serves index.html', async () => {
    const res = await request(server).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Fantasy Football Bot');
  });
});
