/* ================================
   JAIFORE — STUDIO PRINT AREA TESTS
   backend/test/printZones.test.js

   The Anthropic SDK is mocked; no network.
   Run with: npx jest test/printZones.test.js
   ================================ */
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({ beta: { messages: { create: (...a) => mockCreate(...a) } } })));

const pz = require('../printZones');

const reply = (obj, stop_reason = 'end_turn') => ({
  stop_reason, content: [{ type: 'text', text: JSON.stringify(obj) }],
});
const BAG = 'https://jaifore.org/images/tote-bag-front-f.jpg';

beforeEach(() => mockCreate.mockReset());

describe('cleanBox', () => {
  it('rounds, clamps to the photo and rejects tiny or broken boxes', () => {
    expect(pz.cleanBox({ left: 0.0651, top: 0.31, width: 0.29, height: 0.18 }))
      .toEqual({ left: 0.065, top: 0.31, width: 0.29, height: 0.18 });
    expect(pz.cleanBox({ left: 0.9, top: -0.2, width: 0.5, height: 0.5 }))
      .toEqual({ left: 0.9, top: 0, width: 0.1, height: 0.5 });
    expect(pz.cleanBox({ left: 0.1, top: 0.1, width: 0.01, height: 0.5 })).toBeNull();
    expect(pz.cleanBox({ left: 'x', top: 0, width: 0.5, height: 0.5 })).toBeNull();
  });
});

describe('detectBox', () => {
  it('sends the photo and target, and returns the box', async () => {
    mockCreate.mockResolvedValue(reply({ found: true, left: 0.06, top: 0.31, width: 0.29, height: 0.18 }));
    await expect(pz.detectBox(BAG, 'bag')).resolves.toEqual({ left: 0.06, top: 0.31, width: 0.29, height: 0.18 });
    const params = mockCreate.mock.calls[0][0];
    expect(params.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'url', url: BAG } });
    expect(params.messages[0].content[1].text).toMatch(/tote bag/);
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.fallbacks).toBe('default');
  });

  it('returns null when not found, refused or unparseable', async () => {
    mockCreate.mockResolvedValueOnce(reply({ found: false, left: 0, top: 0, width: 0, height: 0 }));
    mockCreate.mockResolvedValueOnce(reply({}, 'refusal'));
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'oops' }] });
    for (let i = 0; i < 3; i++) await expect(pz.detectBox(BAG, 'bag')).resolves.toBeNull();
  });

  it('never calls Claude for an unknown target', async () => {
    await expect(pz.detectBox(BAG, 'hat')).resolves.toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('readTargets / readManualZones', () => {
  it('accepts known targets per view and drops blanks', () => {
    expect(pz.readTargets({ front: 'leg_left', back: 'leg_right' }).value).toEqual({ front: 'leg_left', back: 'leg_right' });
    expect(pz.readTargets({ front: 'bag', back: '' }).value).toEqual({ front: 'bag' });
    expect(pz.readTargets(undefined).value).toBeUndefined();
    expect(pz.readTargets({ front: 'rocket' }).error).toMatch(/Unknown/);
  });
  it('validates hand-adjusted boxes', () => {
    expect(pz.readManualZones({ front_female: { left: 0.1, top: 0.2, width: 0.3, height: 0.2 } }).value.front_female)
      .toEqual({ left: 0.1, top: 0.2, width: 0.3, height: 0.2 });
    expect(pz.readManualZones({ side_male: { left: 0, top: 0, width: 1, height: 1 } }).error).toMatch(/slot/);
    expect(pz.readManualZones({ front_male: { left: 0 } }).error).toMatch(/between 0 and 1/);
  });
});

describe('resolveZones', () => {
  const box = { left: 0.1, top: 0.2, width: 0.3, height: 0.2 };
  const photos = { front_male: null, back_male: null, front_female: BAG, back_female: null, image_url: null };

  it('detects only slots that have a target and a photo', async () => {
    const detect = jest.fn().mockResolvedValue(box);
    const { zones, status } = await pz.resolveZones({ photos, targets: { front: 'bag' }, previous: {}, detect });
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledWith(BAG, 'bag');
    expect(zones).toEqual({ front_female: { ...box, url: BAG, target: 'bag' } });
    expect(status).toEqual({ front_female: 'found' });
  });

  it('keeps a stored box while photo and target are unchanged, re-detects when asked', async () => {
    const previous = { front_female: { ...box, url: BAG, target: 'bag' } };
    const detect = jest.fn().mockResolvedValue({ ...box, left: 0.15 });
    const kept = await pz.resolveZones({ photos, targets: { front: 'bag' }, previous, detect });
    expect(detect).not.toHaveBeenCalled();
    expect(kept.status.front_female).toBe('kept');
    const again = await pz.resolveZones({ photos, targets: { front: 'bag' }, previous, redetect: true, detect });
    expect(again.zones.front_female.left).toBe(0.15);
  });

  it('re-detects when the photo changes, and keeps the old box if detection fails', async () => {
    const previous = { front_female: { ...box, url: 'https://old.example/a.jpg', target: 'bag' } };
    const ok = await pz.resolveZones({ photos, targets: { front: 'bag' }, previous, detect: jest.fn().mockResolvedValue(box) });
    expect(ok.zones.front_female.url).toBe(BAG);

    const same = { front_female: { ...box, url: BAG, target: 'bag' } };
    const failed = await pz.resolveZones({
      photos, targets: { front: 'bag' }, previous: same, redetect: true,
      detect: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    expect(failed.status.front_female).toBe('failed');
    expect(failed.zones.front_female).toEqual(same.front_female);
  });

  it('uses a hand-adjusted box without calling Claude, and drops boxes with no target', async () => {
    const detect = jest.fn();
    const { zones, status } = await pz.resolveZones({
      photos, targets: { front: 'bag' }, previous: { back_male: { ...box, url: BAG, target: 'top_back' } },
      manual: { front_female: box }, detect,
    });
    expect(detect).not.toHaveBeenCalled();
    expect(status.front_female).toBe('manual');
    expect(zones).toEqual({ front_female: { ...box, url: BAG, target: 'bag', manual: true } });
  });

  it('falls back to the main product photo when a slot has none', async () => {
    const detect = jest.fn().mockResolvedValue(box);
    const { zones } = await pz.resolveZones({
      photos: { image_url: BAG }, targets: { front: 'top_front' }, previous: null, detect,
    });
    expect(Object.keys(zones).sort()).toEqual(['front_female', 'front_male']);
  });
});
