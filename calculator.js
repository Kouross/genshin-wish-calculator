/* Probability engine for the wish calculator. Kept independent from the UI. */
(() => {
  'use strict';

  const clampInt = (value, min, max) => {
    const n = Number(value);
    return Number.isFinite(n)
      ? Math.max(min, Math.min(max, Math.floor(n)))
      : min;
  };

  function fiveStarRate(banner, pity) {
    const pullNumber = pity + 1;

    if (banner === 'character') {
      if (pullNumber >= 90) return 1;
      return Math.min(1, 0.006 + 0.06 * Math.max(0, pullNumber - 73));
    }

    if (pullNumber >= 80) return 1;
    return Math.min(1, 0.007 + 0.07 * Math.max(0, pullNumber - 62));
  }

  // Cumulative probability of getting the requested number of copies by each pull.
  function successCdf(
    banner,
    maxPulls,
    wantedCopies,
    initialPity,
    guaranteed,
    path,
    radiance
  ) {
    const cdf = new Float64Array(maxPulls + 1);

    if (wantedCopies <= 0) {
      cdf.fill(1);
      return cdf;
    }

    const encode = (copies, pity, guarantee, fatePoint, radiancePity) =>
      `${copies}|${pity}|${Number(Boolean(guarantee))}|${Number(Boolean(fatePoint))}|${radiancePity}`;

    let states = new Map([
      [encode(0, initialPity, guaranteed, path, radiance), 1]
    ]);

    const radianceRate = [0.5, 0.525, 0.75, 1];

    for (let pull = 1; pull <= maxPulls; pull++) {
      const next = new Map();
      let newlySuccessful = 0;

      const add = (copies, pity, guarantee, fatePoint, radiancePity, probability) => {
        if (!Number.isFinite(probability) || probability <= 0) return;

        if (copies >= wantedCopies) {
          newlySuccessful += probability;
          return;
        }

        const key = encode(copies, pity, guarantee, fatePoint, radiancePity);
        next.set(key, (next.get(key) || 0) + probability);
      };

      for (const [key, mass] of states) {
        const [copies, pity, guarantee, fatePoint, radiancePity] =
          key.split('|').map(Number);

        const starChance = fiveStarRate(banner, pity);

        add(
          copies,
          pity + 1,
          guarantee,
          fatePoint,
          radiancePity,
          mass * (1 - starChance)
        );

        if (banner === 'character') {
          const featuredChance = guarantee
            ? 1
            : radianceRate[Math.min(3, radiancePity)];

          add(
            copies + 1,
            0,
            0,
            0,
            guarantee ? radiancePity : 0,
            mass * starChance * featuredChance
          );

          if (!guarantee) {
            add(
              copies,
              0,
              1,
              0,
              Math.min(3, radiancePity + 1),
              mass * starChance * (1 - featuredChance)
            );
          }
        } else {
          const targetChance = fatePoint
            ? 1
            : (guarantee ? 0.5 : 0.375);

          add(
            copies + 1,
            0,
            0,
            0,
            0,
            mass * starChance * targetChance
          );

          if (!fatePoint) {
            // A non-selected 5-star awards the Epitomized Path point.
            add(
              copies,
              0,
              0,
              1,
              0,
              mass * starChance * (1 - targetChance)
            );
          }
        }
      }

      const totalSuccess = cdf[pull - 1] + newlySuccessful;
      cdf[pull] = Number.isFinite(totalSuccess)
        ? Math.min(1, totalSuccess)
        : cdf[pull - 1];

      states = next;
    }

    return cdf;
  }

  function toPmf(cdf) {
    const pmf = new Float64Array(cdf.length);
    pmf[0] = Number.isFinite(cdf[0]) ? cdf[0] : 0;

    for (let i = 1; i < cdf.length; i++) {
      const delta = cdf[i] - cdf[i - 1];
      pmf[i] = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    }

    return pmf;
  }

  function calculate(input) {
    const characterCopies = clampInt(input.characterCopies, 0, 7);
    const weaponCopies = clampInt(input.weaponCopies, 0, 5);
    const wishes = clampInt(input.wishes, 0, 1000000);
    const characterPity = clampInt(input.characterPity, 0, 89);
    const weaponPity = clampInt(input.weaponPity, 0, 79);
    const radiance = clampInt(input.radiance, 0, 3);
    const characterGuaranteed = Boolean(Number(input.characterGuaranteed));
    const weaponGuaranteed = Boolean(Number(input.weaponGuaranteed));
    const fatePoint = clampInt(input.fatePoint, 0, 1);

    // Cover the modeled worst case, including Capturing Radiance.
    const maxNeeded = characterCopies * 360 + weaponCopies * 160;
    const limit = Math.min(wishes, maxNeeded);

    const characterCdf = successCdf(
      'character',
      limit,
      characterCopies,
      characterPity,
      characterGuaranteed,
      0,
      radiance
    );

    const weaponCdf = successCdf(
      'weapon',
      limit,
      weaponCopies,
      weaponPity,
      weaponGuaranteed,
      fatePoint,
      0
    );

    const characterPmf = toPmf(characterCdf);
    const weaponPmf = toPmf(weaponCdf);

    let combined = 0;

    for (let charPulls = 0; charPulls <= limit; charPulls++) {
      for (let weaponPulls = 0; weaponPulls <= limit - charPulls; weaponPulls++) {
        const part = characterPmf[charPulls] * weaponPmf[weaponPulls];
        if (Number.isFinite(part)) combined += part;
      }
    }

    const safe = value =>
      Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

    return {
      combined: safe(combined),
      characterOnly: safe(characterCdf[Math.min(wishes, characterCdf.length - 1)]),
      weaponOnly: safe(weaponCdf[Math.min(wishes, weaponCdf.length - 1)]),
      wishes,
      characterCopies,
      weaponCopies
    };
  }

  window.WishCalculator = { calculate };
})();
