// The Google package (Part 5): every call recorded before it is made and refused at a cap or on
// any counter error (fail closed); the requests Google gets (the Essentials field mask, one Routes
// call per plan); which parts use Google. A fake database that counts like google_take() does
// (pgTAP google_package.test.sql runs the real one), and a fake fetch that counts the calls.
import { assert, assertEquals, assertRejects } from "@std/assert";
import type { Db } from "./db.ts";
import {
  autocompleteRequest,
  autocompleteResponse,
  DETAILS_FIELDS,
  detailsRequest,
  detailsResponse,
  googleUse,
  guarded,
  routesRequest,
  routesResponse,
  takeGoogleCall,
} from "./google.ts";
import { fetchPin, googlePin } from "./googlePlaces.ts";
import { matchPoints } from "./matching.ts";
import { legSequence } from "./plan.ts";
import { googleLegs, legKey, memoLegFn } from "./routing.ts";
import { GOOGLE_HARD_CEILING, type GoogleCaps, type GoogleFeature, type Settings, SETTINGS_DEFAULTS, validateSetting } from "./settings.ts";
import { snapProvider } from "./tools/locations.ts";

const NOW = new Date("2026-10-16T04:30:00Z"); // 10:00 Colombo
const KANDY = { lat: 7.2906, lng: 80.6337 };
const COLOMBO = { lat: 6.9344, lng: 79.8428 };
const GALLE = { lat: 6.0329, lng: 80.2168 };
const DETAILS = {
  location: { latitude: 7.2931, longitude: 80.6350 },
  formattedAddress: "Kandy City Centre, 5 Dalada Veediya, Kandy 20000, Sri Lanka",
  shortFormattedAddress: "5 Dalada Veediya, Kandy",
  addressComponents: [{ longText: "Kandy District", types: ["administrative_area_level_2", "political"] }],
};

function settingsWith(caps: Partial<GoogleCaps> = {}, pkg: "google" | "open" = "google"): Settings {
  return { ...structuredClone(SETTINGS_DEFAULTS), map_package: pkg, google_caps: { ...SETTINGS_DEFAULTS.google_caps, ...caps } };
}

type Counter = "ok" | "error" | "throw" | "shape";

/** google_take as the database does it (per feature and day, the month's sum, caps clamped), plus google_pins. */
function fakeDb(counter: Counter = "ok") {
  const calls = new Map<string, number>(); // feature|day → calls
  const refused = new Map<string, number>();
  const pins = new Map<string, Record<string, unknown>>();
  const state = { rpcs: 0 };
  const day = "2026-10-16";
  const db = {
    rpc: (name: string, args: { p_feature: GoogleFeature; p_day_cap: number; p_month_cap: number }) => {
      if (name !== "google_take") return Promise.resolve({ data: null, error: null });
      state.rpcs += 1;
      if (counter === "throw") return Promise.reject(new Error("network down"));
      if (counter === "error") return Promise.resolve({ data: null, error: { message: "could not connect" } });
      if (counter === "shape") return Promise.resolve({ data: { ok: true }, error: null });
      const ceiling = GOOGLE_HARD_CEILING[args.p_feature];
      const monthCap = Math.max(0, Math.min(args.p_month_cap, ceiling));
      const dayCap = Math.max(0, Math.min(args.p_day_cap, monthCap));
      const k = `${args.p_feature}|${day}`;
      const used = calls.get(k) ?? 0;
      const month = [...calls.entries()].filter(([key]) => key.startsWith(`${args.p_feature}|2026-10`)).reduce((n, [, v]) => n + v, 0);
      if (used >= dayCap || month >= monthCap) {
        refused.set(k, (refused.get(k) ?? 0) + 1);
        return Promise.resolve({
          data: { allowed: false, reason: month >= monthCap ? "month" : "day", day: used, day_cap: dayCap, month, month_cap: monthCap },
          error: null,
        });
      }
      calls.set(k, used + 1);
      return Promise.resolve({
        data: { allowed: true, day: used + 1, day_cap: dayCap, month: month + 1, month_cap: monthCap },
        error: null,
      });
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return q;
        },
        maybeSingle: () =>
          Promise.resolve({ data: table === "google_pins" ? pins.get(String(filters.google_place_id)) ?? null : null, error: null }),
        upsert: (row: Record<string, unknown>) => {
          pins.set(String(row.google_place_id), row);
          return Promise.resolve({ data: null, error: null });
        },
      };
      return q;
    },
  } as unknown as Db;
  return { db, calls, refused, pins, state, seed: (feature: GoogleFeature, n: number, d = day) => calls.set(`${feature}|${d}`, n) };
}

/** A fetch that answers like Place Details (or Routes) and counts the calls. */
function counted(answer: unknown = DETAILS) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(Response.json(answer));
  };
  return { fetchFn, seen };
}

async function withKeys<T>(keys: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(keys).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(keys)) Deno.env.set(k, v);
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(before)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
}

Deno.test("Place Details: 400 calls a day are made; call 401 is refused before it reaches Google", async () => {
  await withKeys({ GOOGLE_SERVER_KEY: "server-key" }, async () => {
    const { db, calls, refused } = fakeDb();
    const { fetchFn, seen } = counted();
    const settings = settingsWith({ places_details: { day: 400, month: 9500 } });
    for (let i = 1; i <= 400; i++) {
      const got = await fetchPin(db, settings, `place-${i}`, null, NOW, fetchFn);
      assert("pin" in got, `call ${i} should be made`);
    }
    assertEquals(seen.length, 400);
    const call401 = await fetchPin(db, settings, "place-401", null, NOW, fetchFn);
    assertEquals(call401, { note: "Google place details limit reached for today: the open package until tomorrow" });
    assertEquals(seen.length, 400, "Google never got call 401");
    assertEquals([calls.get("places_details|2026-10-16"), refused.get("places_details|2026-10-16")], [400, 1]);
  });
});

Deno.test("a counter error refuses the call: an error answer, a throw, an answer of the wrong shape", async () => {
  await withKeys({ GOOGLE_SERVER_KEY: "server-key" }, async () => {
    for (const counter of ["error", "throw", "shape"] as const) {
      const { db, state } = fakeDb(counter);
      const { fetchFn, seen } = counted();
      const got = await fetchPin(db, settingsWith(), "place-1", null, NOW, fetchFn);
      assertEquals(got, { note: "Google place details paused: the call counter could not be read" }, counter);
      assertEquals([state.rpcs, seen.length], [1, 0], `${counter}: the counter was asked, Google was not`);
    }
  });
});

Deno.test("the month's ceiling refuses too, and a cap of 0 means off; every feature through the same gate", async () => {
  const { db, seed } = fakeDb();
  seed("routes", 4750, "2026-10-03");
  const settings = settingsWith();
  const month = await takeGoogleCall(db, "routes", settings.google_caps);
  assertEquals([month.allowed, month.reason], [false, "month"]);
  let ran = 0;
  const roads = await guarded(db, "roads", settingsWith().google_caps, () => Promise.resolve(++ran));
  assertEquals(roads, {
    ok: false,
    gate: { allowed: false, reason: "month", day: 0, day_cap: 0, month: 0, month_cap: 0 },
    note: "Google snap to roads is off: its cap is 0 (Settings → Fleet)",
  });
  // A setting above the hard ceiling is clamped by the counter as well as refused by update_settings.
  const big = await takeGoogleCall(db, "map_loads", { ...settings.google_caps, map_loads: { day: 100000, month: 100000 } });
  assertEquals([big.allowed, big.month_cap, big.day_cap], [true, 9500, 9500]);
  assertEquals(ran, 0);
});

Deno.test("Place Details asks for the Essentials fields only: location, formattedAddress, shortFormattedAddress, addressComponents", () => {
  assertEquals(DETAILS_FIELDS, "location,formattedAddress,shortFormattedAddress,addressComponents");
  assert(!DETAILS_FIELDS.includes("displayName"), "displayName would make every call Place Details Pro");
  const req = detailsRequest("ChIJ-abc_123", "server-key", "sess-0001-abcd");
  assertEquals(req.method, "GET");
  assertEquals(req.url, "https://places.googleapis.com/v1/places/ChIJ-abc_123?languageCode=en&sessionToken=sess-0001-abcd");
  assertEquals(req.headers, { "X-Goog-Api-Key": "server-key", "X-Goog-FieldMask": DETAILS_FIELDS });
  assertEquals(detailsResponse(DETAILS), {
    lat: 7.2931,
    lng: 80.635,
    address: "Kandy City Centre, 5 Dalada Veediya, Kandy 20000, Sri Lanka",
    short_address: "5 Dalada Veediya, Kandy",
    district: "Kandy",
  });
});

Deno.test("Autocomplete: Sri Lanka only, biased 50 km around the base, the session token; the name is the suggestion's main text", () => {
  const req = autocompleteRequest("  Kandy city ", "server-key", { session: "sess-0001-abcd", focus: COLOMBO });
  assertEquals(req.body, {
    input: "Kandy city",
    includedRegionCodes: ["lk"],
    languageCode: "en",
    sessionToken: "sess-0001-abcd",
    locationBias: { circle: { center: { latitude: 6.9344, longitude: 79.8428 }, radius: 50000 } },
  });
  assertEquals(
    req.headers["X-Goog-FieldMask"],
    "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
  );
  const places = autocompleteResponse({
    suggestions: [
      {
        placePrediction: {
          placeId: "p1",
          text: { text: "Kandy City Centre, Dalada Veediya, Kandy" },
          structuredFormat: { mainText: { text: "Kandy City Centre" }, secondaryText: { text: "Dalada Veediya, Kandy" } },
        },
      },
      { queryPrediction: { text: { text: "kandy hotels" } } },
    ],
  });
  assertEquals(places, [{
    place_id: "p1",
    name: "Kandy City Centre",
    label: "Kandy City Centre, Dalada Veediya, Kandy",
    secondary: "Dalada Veediya, Kandy",
  }]);
});

Deno.test("a kept pin is used while it lasts past the task's day; an older one is fetched again (one counted call)", async () => {
  await withKeys({ GOOGLE_SERVER_KEY: "server-key" }, async () => {
    const { db, pins } = fakeDb();
    const { fetchFn, seen } = counted();
    pins.set("p1", {
      google_place_id: "p1",
      lat: 7.29,
      lng: 80.63,
      address: "a",
      short_address: null,
      district: null,
      fetched_at: "2026-10-01T00:00:00Z",
    });
    const soon = await googlePin(db, settingsWith(), "p1", { now: NOW, until: new Date("2026-10-20T18:30:00Z") }, fetchFn);
    assertEquals([("pin" in soon) && soon.pin.lat, seen.length], [7.29, 0]);
    const later = await googlePin(db, settingsWith(), "p1", { now: NOW, until: new Date("2026-11-02T18:30:00Z") }, fetchFn);
    assertEquals([("pin" in later) && later.pin.lat, seen.length], [7.2931, 1]);
  });
});

Deno.test("Routes: one call answers every leg of a plan (TRAFFIC_AWARE, the stops as intermediates); the planner reads them", async () => {
  await withKeys({ GOOGLE_SERVER_KEY: "server-key" }, async () => {
    const points = legSequence({
      start: { name: "base", point: COLOMBO },
      base: { name: "base", point: COLOMBO },
      stops: [
        { seq: 1, type: "pickup", what: "people", name: "Kandy", point: KANDY },
        { seq: 2, type: "visit", what: null, name: "no pin", point: null },
        { seq: 3, type: "drop", what: "people", name: "Galle", point: GALLE },
      ],
      return_to_base: true,
    });
    assertEquals(points, [COLOMBO, KANDY, GALLE, COLOMBO]);
    const req = routesRequest(points, "2026-10-16T05:00:00Z", "server-key", { avoid_expressway: false }, NOW);
    const body = req.body as Record<string, unknown>;
    assertEquals([body.routingPreference, body.departureTime, (body.intermediates as unknown[]).length], [
      "TRAFFIC_AWARE",
      "2026-10-16T05:00:00.000Z",
      2,
    ]);
    assertEquals(req.headers["X-Goog-FieldMask"], "routes.legs.duration,routes.legs.distanceMeters");
    const past = routesRequest(points, "2026-10-16T04:00:00Z", "k", { avoid_expressway: true }, NOW).body as Record<string, unknown>;
    assertEquals([past.departureTime, past.routeModifiers], [undefined, { avoidHighways: true }]);

    const answer = {
      routes: [{
        legs: [{ duration: "7200s", distanceMeters: 115400 }, { duration: "12600s", distanceMeters: 220000 }, {
          duration: "5400s",
          distanceMeters: 119000,
        }],
      }],
    };
    const { db, calls } = fakeDb();
    const { fetchFn, seen } = counted(answer);
    const got = await googleLegs(db, settingsWith(), points, "2026-10-16T05:00:00Z", { avoid_expressway: false }, NOW, fetchFn);
    assert("legs" in got);
    assertEquals([seen.length, calls.get("routes|2026-10-16")], [1, 1]);
    const leg = memoLegFn(got.legs, () => Promise.reject(new Error("no other call")));
    assertEquals(await leg(KANDY, GALLE, "2026-10-16T07:00:00Z", { avoid_expressway: false }), {
      km: 220,
      minutes: 210,
      source: "google",
      via_expressway: null,
      factor: 1,
    });
    assertEquals(got.legs.has(legKey(GALLE, COLOMBO)), true);
    assertEquals(routesResponse(answer, 3).length, 3);
    await assertRejects(() => Promise.resolve().then(() => routesResponse(answer, 2)));
  });
});

Deno.test("which parts use Google: the package, then each key; snap only with both keys and only for the web", () => {
  const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });
  assertEquals(googleUse(settingsWith(), env({})), {
    package: "open",
    configured: { js: false, server: false },
    map: false,
    places: false,
    routes: false,
    roads: false,
  });
  assertEquals(googleUse(settingsWith(), env({ GOOGLE_SERVER_KEY: "s" })), {
    package: "google",
    configured: { js: false, server: true },
    map: false,
    places: true,
    routes: true,
    roads: false,
  });
  assertEquals(googleUse(settingsWith(), env({ GOOGLE_SERVER_KEY: "s", GOOGLE_MAPS_JS_KEY: "j" })).roads, true);
  assertEquals(googleUse(settingsWith({}, "open"), env({ GOOGLE_SERVER_KEY: "s", GOOGLE_MAPS_JS_KEY: "j" })).package, "open");
});

Deno.test("snap to roads: Google for the web only, never for Claude; OSRM when set; none otherwise", async () => {
  await withKeys({ GOOGLE_SERVER_KEY: "s", GOOGLE_MAPS_JS_KEY: "j" }, () => {
    assertEquals(snapProvider(settingsWith(), "web"), "google_roads");
    assertEquals(snapProvider(settingsWith(), "claude"), "none");
    const open = { ...settingsWith({}, "open"), map_matching: { provider: "google_roads" as const } };
    assertEquals(snapProvider(open, "web"), "none", "Google's lines never go on the open package's map");
    assertEquals(snapProvider({ ...open, map_matching: { provider: "osrm" } }, "web"), "osrm");
    return Promise.resolve();
  });
});

Deno.test("a refused Roads call is never sent: the gate is asked before each 100-point call", async () => {
  const points = Array.from({ length: 30 }, (_, i) => ({ at: i * 5000, lat: 6.9 + i * 0.0005, lng: 79.85 + i * 0.0005 }));
  let fetched = 0;
  const fetchFn = () => {
    fetched += 1;
    return Promise.resolve(Response.json({ snappedPoints: [] }));
  };
  await assertRejects(
    () =>
      matchPoints(
        "google_roads",
        points,
        { key: "s" },
        fetchFn,
        () => undefined,
        () => Promise.resolve("Google snap to roads limit reached for today: the open package until tomorrow"),
      ),
    Error,
    "limit reached for today",
  );
  assertEquals(fetched, 0);
});

Deno.test("google_caps: every feature, the month never above 95 % of the free usage, the day never above the month", () => {
  const caps = validateSetting("google_caps", SETTINGS_DEFAULTS.google_caps);
  assertEquals(caps, SETTINGS_DEFAULTS.google_caps);
  assertEquals(SETTINGS_DEFAULTS.google_caps.roads, { day: 0, month: 0 }, "snap to roads starts off (the asset tracking licence)");
  const tooBig = { ...SETTINGS_DEFAULTS.google_caps, routes: { day: 200, month: 5000 } };
  let message = "";
  try {
    validateSetting("google_caps", tooBig);
  } catch (e) {
    message = (e as Error).message;
  }
  assertEquals(message, "google_caps.routes.month: a whole number from 0 to 4750 is needed.");
  try {
    validateSetting("google_caps", { ...SETTINGS_DEFAULTS.google_caps, map_loads: { day: 500, month: 400 } });
  } catch (e) {
    message = (e as Error).message;
  }
  assertEquals(message, "google_caps.map_loads.day: a whole number from 0 to 400 is needed.");
});
