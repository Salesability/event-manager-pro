// Harness ownership markers (0111). Every row the demo seeds write is
// identifiable by one of these, and every clean() sweeps ONLY by them — the
// scoped "reset" that cannot touch real sandbox data (Atlantic dealers, QBO
// links, real quotes/MSAs are unregenerable).

/** publicId prefix for demo dealers/campaigns — `demo-dealer`, `demo-sms-campaign`. */
export const DEMO_PUBLIC_ID_PREFIX = 'demo-';

/**
 * Reserved demo phone block. Sibling smoke fixtures own their own blocks
 * (+1999558 = 0110, +1999559 = 0108) — this one is the harness's; never dial.
 */
export const DEMO_PHONE_PREFIX = '+1999555';
