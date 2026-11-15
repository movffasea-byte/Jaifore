const jwt = require('jsonwebtoken');
const { pool } = require('./database');

// Verifies a bearer token AND checks it against the database: the user must
// still exist, the token must carry the user's current token_version (bumped on
// every password change), and the role comes from the DB, not the token.
// Tokens issued before versions existed have no `tv` and count as version 0.
// Throws on any failure; callers treat that as "not signed in".
async function verifyUserToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const { rows } = await pool.query('SELECT role, token_version FROM users WHERE id = $1', [decoded.id]);
  if (!rows.length) throw new Error('User no longer exists.');
  if ((decoded.tv || 0) !== rows[0].token_version) throw new Error('Token revoked.');
  return { ...decoded, role: rows[0].role };
}

module.exports = { verifyUserToken };
