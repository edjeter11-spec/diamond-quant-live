import { describe, it, expect, beforeEach, vi } from "vitest";

// api-keys.ts reads process.env at MODULE LOAD time to build ALL_KEYS, so the
// env vars must be set before the module is imported. We stub them here and
// import fresh via vi.resetModules() + dynamic import in each test.
async function loadFreshModule() {
  vi.resetModules();
  return import("./api-keys");
}

const KEY_ENV_VARS = [
  "THE_ODDS_API_KEY_PAID",
  "THE_ODDS_API_KEY",
  "THE_ODDS_API_KEY_2",
  "THE_ODDS_API_KEY_3",
  "THE_ODDS_API_KEY_4",
  "THE_ODDS_API_KEY_5",
  "THE_ODDS_API_KEY_6",
  "THE_ODDS_API_KEY_7",
  "THE_ODDS_API_KEY_8",
  "THE_ODDS_API_KEY_9",
];

function setKeys(count: number) {
  for (const v of KEY_ENV_VARS) delete process.env[v];
  for (let i = 0; i < count; i++) {
    // Keys must be >10 chars to survive the module's length filter.
    process.env[KEY_ENV_VARS[i]] = `test-key-${i}-abcdefghij`;
  }
}

beforeEach(() => {
  for (const v of KEY_ENV_VARS) delete process.env[v];
});

// Guards against the "odds-key rotation gives up too early" bug class: with
// N keys configured, marking N-1 exhausted must still yield the 1 remaining
// valid key, not null — and getApiKey() must only return null when ALL are
// exhausted.
describe("odds api-key rotation", () => {
  it("counts all configured keys", async () => {
    setKeys(10);
    const mod = await loadFreshModule();
    expect(mod.getKeyCount()).toBe(10);
    expect(mod.getActiveKeyCount()).toBe(10);
  });

  it("still returns the last remaining key after 9 of 10 are exhausted", async () => {
    setKeys(10);
    const mod = await loadFreshModule();
    const keys: string[] = [];
    for (let i = 0; i < 9; i++) {
      const k = mod.getApiKey();
      expect(k).not.toBeNull();
      keys.push(k as string);
      mod.markKeyExhausted(k as string);
    }
    expect(mod.getActiveKeyCount()).toBe(1);
    const last = mod.getApiKey();
    expect(last).not.toBeNull();
    expect(keys).not.toContain(last);
  });

  it("returns null only once every key is exhausted", async () => {
    setKeys(3);
    const mod = await loadFreshModule();
    for (let i = 0; i < 3; i++) {
      const k = mod.getApiKey();
      expect(k).not.toBeNull();
      mod.markKeyExhausted(k as string);
    }
    expect(mod.getActiveKeyCount()).toBe(0);
    expect(mod.getApiKey()).toBeNull();
  });

  it("resetExhaustedKeys restores availability", async () => {
    setKeys(2);
    const mod = await loadFreshModule();
    const k1 = mod.getApiKey() as string;
    mod.markKeyExhausted(k1);
    const k2 = mod.getApiKey() as string;
    mod.markKeyExhausted(k2);
    expect(mod.getApiKey()).toBeNull();
    mod.resetExhaustedKeys();
    expect(mod.getApiKey()).not.toBeNull();
    expect(mod.getActiveKeyCount()).toBe(2);
  });

  it("trims whitespace and drops short/empty keys", async () => {
    for (const v of KEY_ENV_VARS) delete process.env[v];
    process.env.THE_ODDS_API_KEY_PAID = "  padded-key-value  \n";
    process.env.THE_ODDS_API_KEY = "short"; // <=10 chars, filtered out
    process.env.THE_ODDS_API_KEY_2 = "";
    const mod = await loadFreshModule();
    expect(mod.getKeyCount()).toBe(1);
    expect(mod.getApiKey()).toBe("padded-key-value");
  });
});
