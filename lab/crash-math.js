// Duck Rocket (crash): when the rocket blows up, and how fast the multiplier climbs. No
// graphics here, so the odds can be checked on their own.
//
// The crash point is decided at launch. With a 3% house edge, the chance the rocket is
// still flying at multiplier x is 0.97 / x, so cashing out at any target returns 97% over
// time: a 2× target cashes 48.5% of the time, 10× about 9.7%. About four launches in a
// hundred blow up on the pad (at 1.00×).

export const EDGE = 0.03;
export const MAX_MULT = 1000;
export const RATE = 0.11;             // the multiplier grows by e^(RATE·seconds): 2× at 6.3 s, 10× at 21 s

export function crashPoint(rand) {
  const u = rand();
  const m = Math.floor(((1 - EDGE) / (1 - u)) * 100) / 100;
  return Math.min(MAX_MULT, Math.max(1, m));
}
export const multAt = seconds => Math.exp(RATE * seconds);
export const timeTo = mult => Math.log(mult) / RATE;
