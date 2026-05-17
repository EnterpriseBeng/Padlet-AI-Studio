const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '20mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  const storage = multer.memoryStorage();
  const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'text/csv',
        'image/jpeg', 'image/png', 'image/gif', 'image/webp'
      ];
      cb(null, allowed.includes(file.mimetype));
    }
  });

  // ── Anthropic proxy ──────────────────────────────────────────────────────────
  app.post('/api/claude', async (req, res) => {
  const { apiKey, messages, system, max_tokens = 2000 } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'Anthropic API key required' });

  try {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens,
      messages
    };
    if (system) body.system = system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
  });

  // ── Padlet: Get Board ─────────────────────────────────────────────────────────
  app.post('/api/padlet/board', async (req, res) => {
  const { padletKey, boardId } = req.body;
  try {
    const r = await fetch(
      `https://api.padlet.dev/v1/boards/${boardId}?include=posts,sections`,
      { headers: { 'X-API-KEY': padletKey, 'Accept': 'application/vnd.api+json' } }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
  });

  // ── Padlet: Create Post ───────────────────────────────────────────────────────
  app.post('/api/padlet/post', async (req, res) => {
  const { padletKey, boardId, subject, bodyHtml, attachmentUrl } = req.body;
  const content = { subject, bodyHtml };
  if (attachmentUrl) content.attachment = { url: attachmentUrl };

  try {
    const r = await fetch(`https://api.padlet.dev/v1/boards/${boardId}/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'X-API-KEY': padletKey
      },
      body: JSON.stringify({ data: { type: 'post', attributes: { content } } })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
  });

  // ── Padlet: Create Multiple Posts ─────────────────────────────────────────────
  app.post('/api/padlet/posts-bulk', async (req, res) => {
  const { padletKey, boardId, posts } = req.body;
  const results = [];

  for (const post of posts) {
    try {
      const r = await fetch(`https://api.padlet.dev/v1/boards/${boardId}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json',
          'X-API-KEY': padletKey
        },
        body: JSON.stringify({
          data: {
            type: 'post',
            attributes: {
              content: {
                subject: post.subject,
                bodyHtml: post.bodyHtml
              }
            }
          }
        })
      });
      const data = await r.json();
      results.push({ ok: r.ok, data, subject: post.subject });
      await new Promise(r => setTimeout(r, 300)); // rate-limit buffer
    } catch (err) {
      results.push({ ok: false, error: err.message, subject: post.subject });
    }
  }
  res.json({ results });
  });

  // ── File Upload + Extract Text ────────────────────────────────────────────────
  app.post('/api/extract-file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { mimetype, buffer, originalname } = req.file;
  let text = '';

  try {
    if (mimetype === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const parsed = await pdfParse(buffer);
      text = parsed.text;
    } else if (mimetype.includes('wordprocessingml')) {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (mimetype.includes('spreadsheetml') || mimetype === 'text/csv') {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheets = wb.SheetNames.map(name => {
        const ws = wb.Sheets[name];
        return `Sheet: ${name}\n${XLSX.utils.sheet_to_csv(ws)}`;
      });
      text = sheets.join('\n\n');
    } else if (mimetype === 'text/plain') {
      text = buffer.toString('utf-8');
    } else if (mimetype.startsWith('image/')) {
      // Return as base64 for Claude vision
      return res.json({
        type: 'image',
        mimetype,
        base64: buffer.toString('base64'),
        name: originalname
      });
    }

    res.json({ type: 'text', text: text.slice(0, 15000), name: originalname });
  } catch (err) {
    res.status(500).json({ error: `Failed to parse file: ${err.message}` });
  }
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

function startServer(port = process.env.PORT || 3000) {
  const app = createApp();
  return app.listen(port, () => {
    console.log(`Padlet AI Studio running at http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { createApp, startServer };
