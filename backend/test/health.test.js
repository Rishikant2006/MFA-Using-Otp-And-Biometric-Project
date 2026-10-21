const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-longer-than-thirty-two-characters';
process.env.FRONTEND_URL = 'http://localhost:5500';

const { app } = require('../server');

test('health endpoint returns a request id and status payload', async () => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  const result = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${address.port}/api/health`, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body) }),
        );
      })
      .on('error', reject);
  });
  await new Promise((resolve) => server.close(resolve));
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.match(result.headers['x-request-id'], /^[0-9a-f-]{36}$/);
});
