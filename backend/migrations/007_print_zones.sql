-- Studio print areas found by Claude (backend/printZones.js).
-- print_targets: what each view prints on, e.g. {"front": "bag"} or
--   {"front": "leg_left", "back": "leg_right"}. Empty = today's shared box.
-- print_zones: the box per mockup slot as fractions of the photo, e.g.
--   {"front_female": {"left":0.06,"top":0.31,"width":0.29,"height":0.18,
--                     "url":"https://...","target":"bag"}}
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS print_targets JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS print_zones   JSONB NOT NULL DEFAULT '{}'::jsonb;
