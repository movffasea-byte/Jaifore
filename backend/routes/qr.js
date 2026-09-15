/* ================================
   JAI'FORE — QR CODE ROUTES
   backend/routes/qr.js
   ================================ */

const express = require('express');
const router  = express.Router();
const QRCode  = require('qrcode');

const { pool: db }              = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

// ── PUBLIC: SCAN + REDIRECT ──────────────────────────
// GET /api/qr/:slug — this is what the printed QR image actually encodes.
// Logs the scan, then 302-redirects to whatever destination_url currently
// points to. No auth — this is hit by anyone's phone camera in the wild.
//
// Deliberately looks up by slug (not id) so the printed QR's URL never
// needs to change even if the destination is edited a hundred times —
// only the DB row's destination_url column changes, never the QR image.
router.get('/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    const { rows } = await db.query(
      `SELECT id, destination_url, is_active FROM qr_codes WHERE slug = $1`,
      [slug]
    );

    if (!rows.length || !rows[0].is_active) {
      // Inactive or unknown slug — send to the homepage rather than a bare
      // 404, since this is a physical flyer in someone's hand, not an API
      // consumer that can meaningfully act on an error response.
      return res.redirect(302, process.env.FRONTEND_URL || 'https://jai-fore.vercel.app');
    }

    const qr = rows[0];

    // Fire-and-forget logging — a scan should never be slowed down or
    // blocked by the logging write. If this fails, the redirect still
    // happens; we just lose that one data point, which is an acceptable
    // tradeoff for not making a real person wait on an analytics insert.
    db.query(
      `INSERT INTO qr_scans (qr_code_id, user_agent) VALUES ($1, $2)`,
      [qr.id, req.headers['user-agent'] || null]
    ).catch(err => console.error('[qr] scan log failed:', err.message));

    return res.redirect(302, qr.destination_url);
  } catch (err) {
    console.error('[qr] redirect lookup failed:', err.message);
    return res.redirect(302, process.env.FRONTEND_URL || 'https://jai-fore.vercel.app');
  }
});

// ── ADMIN: LIST ALL QR CODES + THEIR SCAN COUNTS ─────
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    // LEFT JOIN + COUNT so a code with zero scans still shows up with 0,
    // not silently excluded — an admin needs to see "not scanned yet" as
    // clearly as any other count.
    const { rows } = await db.query(
      `SELECT
         qc.id, qc.slug, qc.destination_url, qc.label, qc.is_active, qc.created_at,
         COUNT(qs.id)::int AS scan_count
       FROM qr_codes qc
       LEFT JOIN qr_scans qs ON qs.qr_code_id = qc.id
       GROUP BY qc.id
       ORDER BY qc.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[qr] list failed:', err.message);
    res.status(500).json({ error: 'Failed to load QR codes.' });
  }
});

// ── ADMIN: CREATE A NEW QR CODE ──────────────────────
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { slug, destinationUrl, label } = req.body;

  if (!slug || !destinationUrl) {
    return res.status(400).json({ error: 'slug and destinationUrl are required.' });
  }

  // Keep slugs URL-safe and predictable — this becomes part of a public
  // URL printed on physical flyers, so no spaces/special characters that
  // could get mangled by a QR scanner or a copy-paste.
  const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

  try {
    const { rows } = await db.query(
      `INSERT INTO qr_codes (slug, destination_url, label)
       VALUES ($1, $2, $3)
       RETURNING id, slug, destination_url, label, is_active, created_at`,
      [cleanSlug, destinationUrl, label || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') { // unique_violation on slug
      return res.status(409).json({ error: 'A QR code with this slug already exists.' });
    }
    console.error('[qr] create failed:', err.message);
    res.status(500).json({ error: 'Failed to create QR code.' });
  }
});

// ── ADMIN: UPDATE A QR CODE'S DESTINATION / LABEL / ACTIVE STATE ─────
// This is the whole point of the feature — the printed QR image never
// changes, but where it sends people can be updated anytime by editing
// this row's destination_url.
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const { destinationUrl, label, isActive } = req.body;

  // Build the SET clause dynamically so a partial update (e.g. only
  // toggling isActive) doesn't overwrite fields the admin didn't touch
  // with NULL/undefined.
  const fields = [];
  const values = [];
  let i = 1;

  if (destinationUrl !== undefined) { fields.push(`destination_url = $${i++}`); values.push(destinationUrl); }
  if (label !== undefined)          { fields.push(`label = $${i++}`);           values.push(label); }
  if (isActive !== undefined)       { fields.push(`is_active = $${i++}`);       values.push(isActive); }

  if (!fields.length) {
    return res.status(400).json({ error: 'No fields provided to update.' });
  }

  fields.push(`updated_at = NOW()`);
  values.push(req.params.id);

  try {
    const { rows } = await db.query(
      `UPDATE qr_codes SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, slug, destination_url, label, is_active, updated_at`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'QR code not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[qr] update failed:', err.message);
    res.status(500).json({ error: 'Failed to update QR code.' });
  }
});

// ── ADMIN: DELETE A QR CODE ──────────────────────────
// Cascades to qr_scans via the FK's ON DELETE CASCADE — deleting a code
// also clears its scan history, which is the expected behavior for a
// flyer campaign being retired entirely.
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await db.query(`DELETE FROM qr_codes WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'QR code not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[qr] delete failed:', err.message);
    res.status(500).json({ error: 'Failed to delete QR code.' });
  }
});

// ── ADMIN: GENERATE THE ACTUAL QR IMAGE (PNG) ────────
// Returns a downloadable PNG of the QR code pointing at this backend's
// own /api/qr/:slug redirect endpoint — NOT the destination_url directly.
// This is what actually gets printed on the flyer.
router.get('/:id/image', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT slug FROM qr_codes WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'QR code not found.' });

    const backendBase = process.env.BACKEND_URL || 'https://jai-fore-production.up.railway.app';
    const scanUrl = `${backendBase}/api/qr/${rows[0].slug}`;

    const pngBuffer = await QRCode.toBuffer(scanUrl, {
      type: 'png',
      width: 600,
      margin: 2,
    });

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="qr-${rows[0].slug}.png"`);
    res.send(pngBuffer);
  } catch (err) {
    console.error('[qr] image generation failed:', err.message);
    res.status(500).json({ error: 'Failed to generate QR image.' });
  }
});

// ── ADMIN: SCAN STATS FOR ONE QR CODE ────────────────
// Returns the total count plus a simple day-by-day breakdown, enough for
// a basic Chart.js line/bar view in the admin panel — matches the same
// visualization pattern already used for the revenue dashboard.
router.get('/:id/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const codeRes = await db.query(`SELECT id, slug, label FROM qr_codes WHERE id = $1`, [req.params.id]);
    if (!codeRes.rows.length) return res.status(404).json({ error: 'QR code not found.' });

    const totalRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM qr_scans WHERE qr_code_id = $1`,
      [req.params.id]
    );

    const dailyRes = await db.query(
      `SELECT DATE(scanned_at) AS day, COUNT(*)::int AS count
       FROM qr_scans
       WHERE qr_code_id = $1
       GROUP BY DATE(scanned_at)
       ORDER BY day ASC`,
      [req.params.id]
    );

    res.json({
      code: codeRes.rows[0],
      totalScans: totalRes.rows[0].total,
      dailyScans: dailyRes.rows, // [{ day, count }, ...]
    });
  } catch (err) {
    console.error('[qr] stats failed:', err.message);
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

module.exports = router;