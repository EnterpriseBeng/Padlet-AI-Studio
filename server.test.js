const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./server');

test('server serves the app shell and validates upload requests', async () => {
  const server = startServer(0);

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const { port } = server.address();
    const rootRes = await fetch(`http://127.0.0.1:${port}/`);
    const rootHtml = await rootRes.text();

    assert.equal(rootRes.status, 200);
    assert.match(rootHtml, /Padlet AI Studio/);

    const uploadRes = await fetch(`http://127.0.0.1:${port}/api/extract-file`, {
      method: 'POST'
    });
    const uploadBody = await uploadRes.json();

    assert.equal(uploadRes.status, 400);
    assert.equal(uploadBody.error, 'No file uploaded');
  } finally {
    await new Promise((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve());
    });
  }
});
