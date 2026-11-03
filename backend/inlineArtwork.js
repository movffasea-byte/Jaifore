/* ================================
   JAIFORE — INLINE ARTWORK GUARD
   backend/inlineArtwork.js

   Artwork now goes to Supabase through /api/uploads, and cart, wishlist and
   checkout carry its short URL. Older saved carts may still hold the image
   itself as a data: URL, so those requests are refused with a message that
   asks the customer to upload it again.
   ================================ */
const REUPLOAD_MESSAGE = 'Some artwork in your cart was saved in an old format. Please remove that item and upload the artwork again.';

// True if any string anywhere in the value is a data: URL
function hasInlineArtwork(value, depth = 0) {
  if (typeof value === 'string') return /^\s*data:[\w.+-]+\/[\w.+-]+[;,]/i.test(value);
  if (!value || typeof value !== 'object' || depth > 8) return false;
  return Object.values(value).some(v => hasInlineArtwork(v, depth + 1));
}

module.exports = { hasInlineArtwork, REUPLOAD_MESSAGE };
