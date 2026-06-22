/* ================================
   JAIFORE — BACKUP ROUTE
   backend/routes/backup.js
   ================================ */
const express = require('express');
const router  = express.Router();
const { pool } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

const GITHUB_TOKEN = process.env.GITHUB_BACKUP_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_BACKUP_REPO; // e.g. movffasea-byte/jaifore-backups

// ── HELPERS ──────────────────────────────────────────

// Push a file to GitHub, creating or updating it
async function pushToGitHub(path, content, message) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;

  // Check if file already exists so we can get its SHA (required for updates)
  let sha;
  try {
    const existing = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      }
    });
    if (existing.ok) {
      const data = await existing.json();
      sha = data.sha;
    }
  } catch {
    // File doesn't exist yet — that's fine, we'll create it
  }

  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      Authorization:  `Bearer ${GITHUB_TOKEN}`,
      Accept:         'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub push failed for ${path}: ${err.message}`);
  }

  return res.json();
}

// ── BACKUP ROUTE ──────────────────────────────────────
// Protected by both authenticate + requireAdmin so only
// an admin token OR the cron-job secret can trigger it.
// For the cron job, we use a separate secret header check
// so cron-job.org doesn't need an admin JWT.

router.post('/', async (req, res) => {
  // Allow either: valid admin JWT, OR correct cron secret header
  const cronSecret   = req.headers['x-backup-secret'];
  const validSecret  = cronSecret && cronSecret === process.env.BACKUP_SECRET;

  // Check JWT auth if no cron secret provided
  if (!validSecret) {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    const jwt = require('jsonwebtoken');
    try {
      const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
      if (decoded.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only.' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid token.' });
    }
  }

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return res.status(500).json({ error: 'Backup not configured. Missing GITHUB_BACKUP_TOKEN or GITHUB_BACKUP_REPO.' });
  }

  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const results   = {};
  const errors    = [];

  // ── TABLES TO BACK UP ────────────────────────────────
  const tables = ['users', 'orders', 'products', 'print_pricing'];

  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
      const json   = JSON.stringify(result.rows, null, 2);
      const path   = `backups/${timestamp}/${table}.json`;

      await pushToGitHub(
        path,
        json,
        `backup(${table}): ${result.rows.length} rows — ${timestamp}`
      );

      results[table] = { rows: result.rows.length, status: 'ok' };
    } catch (err) {
      console.error(`Backup failed for table ${table}:`, err.message);
      errors.push({ table, error: err.message });
      results[table] = { status: 'failed', error: err.message };
    }
  }

  // ── WRITE BACKUP MANIFEST ─────────────────────────────
  // A summary file at the root of the backup so it's easy
  // to see what each backup contains at a glance on GitHub
  try {
    const manifest = {
      timestamp,
      created_at: new Date().toISOString(),
      tables:     results,
      errors:     errors.length ? errors : null,
    };
    await pushToGitHub(
      `backups/${timestamp}/manifest.json`,
      JSON.stringify(manifest, null, 2),
      `backup(manifest): ${timestamp} — ${errors.length ? errors.length + ' error(s)' : 'all clean'}`
    );
  } catch (err) {
    errors.push({ table: 'manifest', error: err.message });
  }

  const allOk = errors.length === 0;
  res.status(allOk ? 200 : 207).json({
    message:   allOk ? 'Backup completed successfully.' : 'Backup completed with some errors.',
    timestamp,
    results,
    errors:    errors.length ? errors : null,
  });
});

// ── MANUAL TRIGGER (admin UI convenience) ─────────────
router.get('/status', authenticate, requireAdmin, async (req, res) => {
  // Returns the latest backup manifest from GitHub so admin can
  // quickly check when the last backup ran and if it succeeded
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/backups`;
    const r   = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      }
    });

    if (!r.ok) return res.json({ message: 'No backups found yet.' });

    const dirs = await r.json();
    // Get the most recent backup folder (sorted by date name)
    const latest = dirs
      .filter(d => d.type === 'dir')
      .sort((a, b) => b.name.localeCompare(a.name))[0];

    if (!latest) return res.json({ message: 'No backups found yet.' });

    // Fetch the manifest from the latest backup folder
    const manifestUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/backups/${latest.name}/manifest.json`;
    const mr = await fetch(manifestUrl, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      }
    });

    if (!mr.ok) return res.json({ latest: latest.name, manifest: null });

    const mData    = await mr.json();
    const manifest = JSON.parse(Buffer.from(mData.content, 'base64').toString('utf8'));
    res.json({ latest: latest.name, manifest });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;