// Golden outputs of the shared color code (the colormeris package): fixed,
// seeded inputs through every exported function. Computed once on the code
// before it became a package (Colormeris main 81a9af9); the package must
// reproduce them exactly (numbers rounded to 1e-9).
// biome-ignore-all lint/suspicious/noExplicitAny: the API is passed in as a plain record
type Api = Record<string, any>;
type Rgb = number[];

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const round = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : String(v)) : v,
    ),
  );

function image(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { width, height, data };
}
function put(img: { width: number; data: Uint8ClampedArray }, x: number, y: number, [r, g, b]: Rgb, a = 255) {
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}

export function goldenCases(api: Api) {
  const rnd = lcg(12345);
  const colors: Rgb[] = Array.from({ length: 120 }, () => [0, 1, 2].map(() => Math.floor(rnd() * 256)));
  const labs = colors.map((c) => api.rgbToLab(c));
  const out: Record<string, unknown> = {};

  out.color = {
    lab: labs,
    back: labs.map((l: number[]) => api.labToRgb(l)),
    lin: [0, 1, 17, 128, 254, 255].map((v) => [api.srgbToLinear(v), api.linearToSrgb(v / 255), api.SRGB_TO_LINEAR[v]]),
    lch: labs.map((l: number[]) => [api.labToLch(l), api.hueAngle(l), api.chroma(l)]),
    de: labs.slice(1).map((l: number[], i: number) => [api.deltaE76(labs[i], l), api.deltaE2000(labs[i], l)]),
    dist: ['de76', 'de2000'].map((n) => api.colorDistance(n)(labs[0], labs[1])),
    hex: colors.map((c) => api.rgbToHex(c)),
    parse: api.parseHexColors('#ff0000 00ff00, #0000ff\n#123456'),
    misc: [api.onWhite(100, 0.3), api.lerpRgb([0, 10, 20], [100, 50, 0], 0.25)],
  };

  out.cvd = {
    types: api.CVD_TYPES,
    models: api.CVD_MODELS,
    sim: api.CVD_TYPES.map((t: string) => colors.slice(0, 30).map((c) => api.simulateCvd(c, t))),
    color: [...api.CVD_TYPES, api.ACHROMAT].flatMap((t: string) =>
      ['recommended', ...api.CVD_MODELS].map((model: string) =>
        [0.3, 1].map((severity) => {
          try {
            return api.simulateCvdColor(colors[5], t, { model, severity });
          } catch (e) {
            return `error: ${(e as Error).message}`;
          }
        }),
      ),
    ),
    resolve: [...api.CVD_TYPES, api.ACHROMAT].map((t: string) => api.resolveCvdModel(t)),
    pixels: api.CVD_TYPES.map((t: string) => {
      const px = new Uint8ClampedArray(colors.slice(0, 20).flatMap((c) => [...c, 255]));
      const r = api.simulateCvdPixels(px, t, { severity: 0.7 });
      return Array.from(r ?? px);
    }),
    light: colors.slice(0, 30).map((c) => [api.lightness(c), api.grayscale(c)]),
    stats: api.lightnessStats(colors.slice(0, 40).map((c) => api.lightness(c))),
  };

  const nums = Array.from({ length: 31 }, () => rnd() * 100);
  out.stats = {
    median: api.median(nums),
    upper: api.upperMedian(nums),
    inPlace: api.medianInPlace(Float64Array.from(nums)),
    pct: api.pct(0.4567),
  };

  const maps = api.libraryMaps();
  out.library = {
    count: maps.length,
    names: maps.map((m: { name: string }) => m.name),
    first: round(maps[0]),
    viridis: api.mapColors(api.mapByName('viridis')).slice(0, 8),
    unknown: api.mapByName('no-such-map') ?? null,
    entries: maps
      .filter((_: unknown, i: number) => i % 25 === 0)
      .map((m: { name: string }) => {
        const e = api.mapByName(m.name);
        const rgbs = api.mapColors(e);
        return [m.name, e.kind, rgbs.length, rgbs[0], rgbs[rgbs.length - 1]];
      }),
  };

  // Matching: samples of known maps, reversed and noisy.
  const matchMaps = maps.map((m: { name: string; kind: string }) => ({
    name: m.name,
    kind: m.kind,
    rgbs: api.mapColors(api.mapByName(m.name)),
  }));
  const cases = ['viridis', 'jet', 'coolwarm', 'magma', 'RdBu'].filter((n) => api.mapByName(n));
  out.match = cases.map((name) => {
    const samples = api.colormapSamples({ name }, 64).map((s: { rgb: Rgb }) => s.rgb);
    const rev = api.colormapSamples({ name, reversed: true }, 64).map((s: { rgb: Rgb }) => s.rgb);
    const noisy = samples.map((c: Rgb) => c.map((v) => Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * 12)))));
    return {
      name,
      top: api.identifyColorbar(samples, matchMaps).slice(0, 5),
      within: api.identifyColorbar(rev, matchMaps, { within: 2 }),
      noisy: api.identifyColorbar(noisy, matchMaps, { n: 32 }).slice(0, 3),
      colors: api.identifyColors(noisy, matchMaps).slice(0, 5),
      suggest: [api.suggestColormap(samples), api.suggestColormap(rev, { lowAtStart: true })],
      at: [0, 0.3, 0.77, 1].map((t) =>
        api.cmapColorAt(
          matchMaps.find((m: { name: string }) => m.name === name),
          t,
        ),
      ),
    };
  });
  out.matchMisc = {
    levels: api.MATCH_LEVELS,
    lv: [1, 4, 8].map((s) => api.matchLevel(s)),
    none: api.colormapSamples(null),
  };

  // Metrics and references.
  out.metrics = maps
    .filter((_: unknown, i: number) => i % 40 === 0)
    .map((m: { name: string; kind: string; group?: string }) => {
      const rgbs = api.mapColors(api.mapByName(m.name));
      const opts = { kind: m.kind, cyclic: m.group === 'cyclic' };
      const met = api.colormapMetrics(rgbs, opts);
      return {
        name: m.name,
        met,
        worst: api.worstCvd(met),
        notes: api.ratingNotes(met, { qual: m.kind === 'qualitative' }),
        read: api.readability(rgbs, opts),
        feat: api.mapFeatures(rgbs.slice(0, 16)),
        steps: api.perceptualSteps(rgbs.slice(0, 16)),
        lch: api.lchProfile(rgbs.slice(0, 8)),
      };
    });
  out.metricsMisc = {
    method: api.ratingMethod(),
    read: [api.READ_DE, api.READ_WINDOW],
    stepStats: api.stepStats([1, 2, 3, 4, 10]),
    resample: api.resample([1, 2, 3, 4, 5], 3),
    lchOf: api.lchOf([10, 200, 30]),
  };
  out.refs = {
    refs: api.CMAP_REFS,
    cite: ['viridis', 'jet', 'batlow', 'no-such'].map((n) => api.citeFor(n) ?? null),
    numbers: [...api.buildRefNumbers(maps.slice(0, 60)).entries()],
  };

  // Colorbar sampling on a painted bar: horizontal viridis with an outline and noise.
  const img = image(220, 60);
  const vir = api.mapColors(api.mapByName('viridis'));
  for (let x = 0; x < 220; x++)
    for (let y = 0; y < 60; y++)
      if (x >= 30 && x <= 190 && y >= 20 && y <= 34) {
        const c = vir[Math.round(((x - 30) / 160) * (vir.length - 1))];
        put(
          img,
          x,
          y,
          c.map((v: number) => Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * 6)))),
        );
      }
  for (let x = 29; x <= 191; x++) {
    put(img, x, 19, [0, 0, 0]);
    put(img, x, 35, [0, 0, 0]);
  }
  put(img, 5, 5, [10, 20, 30], 128);
  const samples = api.sampleColorbar(img, { x: 30, y: 27 }, { x: 190, y: 27 }, 3, 64);
  out.colorbar = {
    samples,
    small: api.sampleColorbar(img, { x: 30, y: 27 }, { x: 190, y: 27 }),
    t: labs.slice(0, 20).map((l: number[]) => [api.labToT(l, samples), api.labToT(l, samples, 'de76')]),
    at: [-0.1, 0, 0.25, 0.5, 0.999, 1.2].map((t) => api.colorAtT(samples, t)),
    proj: [
      api.projectT({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 3 }),
      api.pointAtT({ x: 0, y: 0 }, { x: 10, y: 4 }, 0.3),
    ],
    refine: [
      api.refineColorbar(img, { x: 36, y: 31 }, { x: 184, y: 29 }),
      api.refineColorbar(img, { x: 25, y: 22 }, { x: 196, y: 25 }),
      api.refineColorbar(img, { x: 30, y: 27 }, { x: 33, y: 27 }),
    ],
    pixels: [api.readPixel(img, 5, 5), api.readPixel(img, -3, 400), api.readPixel(img, 100.4, 27.6)],
    defaults: api.DEFAULT_SAMPLES,
  };
  return round(out);
}
