import assert from "node:assert/strict";
import test from "node:test";
import { compileAdminModules, createState, okResult } from "./test-admin-helpers.mjs";

const requestedPublishStorageKey = "el-faraon-admin-requested-publish-hash";
const publishCooldownStorageKey = "el-faraon-admin-publish-cooldown-ends-at";
const sessionStorageKey = "el-faraon-admin-session";

const { requireAdminModule } = await compileAdminModules("admin-session-publication-tests", [
  "src/admin/api/sessionStorage.ts",
  "src/admin/app/publicationState.ts",
  "src/admin/app/session.ts",
]);

const { readPasswordSessionFromLocation } = requireAdminModule("api/sessionStorage");
const { createAdminPublicationState } = requireAdminModule("app/publicationState");
const { createAdminSessionController } = requireAdminModule("app/session");

test("publication request expires with its cooldown and legacy values are discarded", () => {
  const originalDateNow = Date.now;
  const now = { value: 1_000_000 };
  Date.now = () => now.value;

  try {
    const browser = installBrowser("https://example.com/admin/");
    const currentContentHash = "11111111111111111111111111111111";
    const deployedContentHash = "22222222222222222222222222222222";
    const state = createState({
      publication: {
        current_content_hash: currentContentHash,
        published_content_hash: currentContentHash,
        deployed_content_hash: deployedContentHash,
        has_unpublished_changes: true,
        publish_requested: false,
      },
    });
    const publicationState = createAdminPublicationState(deployedContentHash);

    publicationState.rememberPublishCooldown(okResult({
      message: "publish_queued",
      cooldown_seconds_remaining: 30,
    }));
    publicationState.markCurrentPublicationRequested(state);

    assert.equal(publicationState.getRequestedPublishHash(), currentContentHash);
    assert.deepEqual(JSON.parse(browser.sessionStorage.getItem(requestedPublishStorageKey)), {
      contentHash: currentContentHash,
      expiresAt: now.value + 30_000,
    });

    now.value += 30_001;

    assert.equal(publicationState.getRequestedPublishHash(), "");
    assert.equal(publicationState.getCooldownSecondsRemaining(), 0);
    assert.equal(browser.sessionStorage.getItem(requestedPublishStorageKey), null);

    browser.sessionStorage.setItem(requestedPublishStorageKey, currentContentHash);
    const stateWithLegacyValue = createAdminPublicationState(deployedContentHash);

    assert.equal(stateWithLegacyValue.getRequestedPublishHash(), "");
    assert.equal(browser.sessionStorage.getItem(requestedPublishStorageKey), null);
  } finally {
    Date.now = originalDateNow;
    uninstallBrowser();
  }
});

test("publication reset clears the request and cross-tab cooldown", () => {
  const browser = installBrowser("https://example.com/admin/");
  const currentContentHash = "11111111111111111111111111111111";
  const publicationState = createAdminPublicationState("22222222222222222222222222222222");

  publicationState.rememberPublishCooldown(okResult({
    message: "publish_queued",
    cooldown_seconds_remaining: 30,
  }));
  publicationState.markCurrentPublicationRequested(createState({
    publication: { current_content_hash: currentContentHash },
  }));
  publicationState.reset();

  assert.equal(browser.sessionStorage.getItem(requestedPublishStorageKey), null);
  assert.equal(browser.localStorage.getItem(publishCooldownStorageKey), null);
  assert.equal(publicationState.getCooldownSecondsRemaining(), 0);

  uninstallBrowser();
});

test("password sessions accept fragments and scrub credentials from the URL", () => {
  const originalDateNow = Date.now;
  Date.now = () => 1_000_000;

  try {
    const browser = installBrowser(
      "https://example.com/admin/#access_token=access-value&refresh_token=refresh-value&type=recovery&expires_in=120",
    );

    assert.deepEqual(readPasswordSessionFromLocation(), {
      accessToken: "access-value",
      refreshToken: "refresh-value",
      expiresAt: 1_120_000,
    });
    assert.equal(browser.replacedUrl, "https://example.com/admin/");
  } finally {
    Date.now = originalDateNow;
    uninstallBrowser();
  }
});

test("password sessions reject and scrub credentials from the query string", () => {
  const browser = installBrowser(
    "https://example.com/admin/?access_token=access-value&refresh_token=refresh-value&type=recovery",
  );

  assert.equal(readPasswordSessionFromLocation(), null);
  assert.equal(browser.replacedUrl, "https://example.com/admin/");

  uninstallBrowser();
});

test("logout and failed refresh reset publication state", async () => {
  const browser = installBrowser("https://example.com/admin/");
  let resets = 0;
  const context = createSessionContext(() => {
    resets += 1;
  });
  const controller = createAdminSessionController(context);

  await controller.logout();
  assert.equal(resets, 1);

  browser.sessionStorage.setItem(sessionStorageKey, JSON.stringify({
    accessToken: "expired-access",
    refreshToken: "expired-refresh",
    expiresAt: 1,
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 401 });

  try {
    await controller.start(() => assert.fail("configuration should be valid"));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(resets, 2);
  assert.equal(browser.sessionStorage.getItem(sessionStorageKey), null);

  uninstallBrowser();
});

function createSessionContext(resetPublicationState) {
  return {
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "public-key",
    },
    hasApiConfig: true,
    async loadAdminState() {
      return createState();
    },
    renderCurrentView() {},
    resetPublicationState,
    async runBusy(action) {
      await action();
    },
    setAdminState() {},
    setStatus() {},
    setStatusMessage() {},
  };
}

function installBrowser(href) {
  const url = new URL(href);
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  const browser = {
    localStorage,
    sessionStorage,
    replacedUrl: null,
  };

  globalThis.document = { title: "Admin" };
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  globalThis.window = {
    localStorage,
    sessionStorage,
    location: {
      href: url.toString(),
      hash: url.hash,
      search: url.search,
    },
    history: {
      replaceState(_state, _title, replacementUrl) {
        browser.replacedUrl = replacementUrl;
      },
    },
  };

  return browser;
}

function uninstallBrowser() {
  delete globalThis.document;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  delete globalThis.window;
}

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }
}
