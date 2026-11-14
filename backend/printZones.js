/* ================================
   JAIFORE — STUDIO PRINT AREAS
   backend/printZones.js

   Each product view can name what gets printed (a "target": the bag, the
   front of the top, a sweatpants leg...). When the admin saves a product,
   Claude looks at that view's mockup photo and returns the box around the
   target. The Studio then zooms to that box and keeps designs inside it.

   Boxes are fractions of the photo (0-1), keyed by mockup slot
   (front_male, back_male, front_female, back_female), because men's and
   women's photos differ. Each stored box remembers the photo URL and
   target it was found for, so it is only re-detected when one changes.
   ================================ */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.PRINT_ZONE_MODEL || 'claude-opus-5-5';

// key -> button label in the Studio, and how Claude should find it.
const TARGETS = {
  top_front:  { label: 'Front',     find: 'the printable front of the top garment (T-shirt, shirt, hoodie or sweatshirt): the chest and stomach panel, between the shoulders and the hem, excluding sleeves and arms' },
  top_back:   { label: 'Back',      find: 'the printable back of the top garment (T-shirt, shirt, hoodie or sweatshirt): the back panel between the shoulders and the hem, excluding sleeves and arms' },
  bag:        { label: 'Bag',       find: 'the flat front panel of the tote bag, excluding the handles' },
  leg_left:   { label: 'Left leg',  find: "the wearer's own LEFT leg of the trousers, sweatpants or shorts (from hip to hem); in a photo of the wearer's front this leg appears on the right side of the image, in a photo of their back it appears on the left side" },
  leg_right:  { label: 'Right leg', find: "the wearer's own RIGHT leg of the trousers, sweatpants or shorts (from hip to hem); in a photo of the wearer's front this leg appears on the left side of the image, in a photo of their back it appears on the right side" },
  beanie:     { label: 'Front',     find: 'the front of the beanie hat, including the folded cuff' },
  cup:        { label: 'Front',     find: 'the printable outside surface of the mug or cup, excluding the handle' },
};

const SLOTS = ['front_male', 'back_male', 'front_female', 'back_female'];
const viewOfSlot = (slot) => (slot.startsWith('front') ? 'front' : 'back');

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  return client;
}

const BOX_SCHEMA = {
  type: 'object',
  properties: {
    found:  { type: 'boolean' },
    left:   { type: 'number' },
    top:    { type: 'number' },
    width:  { type: 'number' },
    height: { type: 'number' },
  },
  required: ['found', 'left', 'top', 'width', 'height'],
  additionalProperties: false,
};

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Checks a box: four finite fractions, inside the photo, not tiny.
 * Returns a clean { left, top, width, height } or null.
 */
function cleanBox(box) {
  if (!box || typeof box !== 'object') return null;
  const vals = ['left', 'top', 'width', 'height'].map((k) => Number(box[k]));
  if (!vals.every(Number.isFinite)) return null;
  let [left, top, width, height] = vals;
  left = Math.min(Math.max(left, 0), 1);
  top = Math.min(Math.max(top, 0), 1);
  width = Math.min(width, 1 - left);
  height = Math.min(height, 1 - top);
  if (width < 0.03 || height < 0.03) return null;
  return { left: round3(left), top: round3(top), width: round3(width), height: round3(height) };
}

/**
 * Asks Claude where `target` is in the photo at `imageUrl`.
 * Returns { left, top, width, height } as fractions, or null if it isn't found.
 * Throws on API or network errors.
 */
async function detectBox(imageUrl, target) {
  const spec = TARGETS[target];
  if (!spec) return null;

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: BOX_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'url', url: imageUrl } },
        {
          type: 'text',
          text:
            `This is a product mockup photo for a print shop. Find ${spec.find}.\n` +
            'Return the tightest box around that area as fractions of the whole image: ' +
            'left and top are the box\'s top-left corner (0 = left/top edge, 1 = right/bottom edge), ' +
            'width and height are its size as a fraction of the image width and height. ' +
            'If the item is not visible in the photo, set found to false and the numbers to 0.',
        },
      ],
    }],
  });

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed.found) return null;
  return cleanBox(parsed);
}

/** Validates the admin's print_targets: { front?: key|null, back?: key|null }. */
function readTargets(input) {
  if (input === undefined) return { value: undefined };
  if (input === null) return { value: {} };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'Print targets must be an object.' };
  const value = {};
  for (const view of ['front', 'back']) {
    const t = input[view];
    if (t === undefined || t === null || t === '') continue;
    if (!TARGETS[t]) return { error: `Unknown print target "${t}".` };
    value[view] = t;
  }
  return { value };
}

/** Validates boxes the admin adjusted by hand: { slot: {left,top,width,height} }. */
function readManualZones(input) {
  if (input === undefined || input === null) return { value: {} };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'Print areas must be an object.' };
  const value = {};
  for (const [slot, box] of Object.entries(input)) {
    if (!SLOTS.includes(slot)) return { error: `Unknown mockup slot "${slot}".` };
    const clean = cleanBox(box);
    if (!clean) return { error: 'Each print area needs left, top, width and height between 0 and 1.' };
    value[slot] = clean;
  }
  return { value };
}

/**
 * Works out the print_zones to store for a product.
 *   photos:   { front_male, back_male, front_female, back_female, image_url }
 *   targets:  { front?, back? }
 *   previous: the stored print_zones (or null)
 *   manual:   boxes the admin adjusted by hand, by slot
 *   redetect: true to ignore stored boxes ("Find again")
 * Returns { zones, status } where status[slot] is
 * 'kept' | 'found' | 'manual' | 'not_found' | 'failed'.
 * Detection failures never throw: the slot keeps its old box if it had one.
 */
async function resolveZones({ photos, targets, previous, manual = {}, redetect = false, detect = detectBox }) {
  const prev = previous && typeof previous === 'object' ? previous : {};
  const zones = {};
  const status = {};

  await Promise.all(SLOTS.map(async (slot) => {
    const target = targets[viewOfSlot(slot)];
    const url = photos[slot] || photos.image_url || null;
    if (!target || !url) return; // nothing to print on here: no box

    const old = prev[slot];
    if (manual[slot]) {
      zones[slot] = { ...manual[slot], url, target, manual: true };
      status[slot] = 'manual';
      return;
    }
    const stillValid = old && old.url === url && old.target === target;
    if (stillValid && !redetect) {
      zones[slot] = old;
      status[slot] = 'kept';
      return;
    }
    try {
      const box = await detect(url, target);
      if (box) {
        zones[slot] = { ...box, url, target };
        status[slot] = 'found';
      } else {
        status[slot] = 'not_found';
        if (stillValid) zones[slot] = old;
      }
    } catch (err) {
      console.error(`[print-zones] ${slot} detection failed:`, err.message);
      status[slot] = 'failed';
      if (stillValid) zones[slot] = old;
    }
  }));

  return { zones, status };
}

const TARGET_LABELS = Object.fromEntries(Object.entries(TARGETS).map(([k, v]) => [k, v.label]));

module.exports = { TARGETS, TARGET_LABELS, SLOTS, cleanBox, detectBox, readTargets, readManualZones, resolveZones };
