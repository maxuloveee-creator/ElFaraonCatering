import assert from "node:assert/strict";
import test from "node:test";
import { compileAdminModules, createState } from "./test-admin-helpers.mjs";

const sessionStorageKey = "el-faraon-admin-session";

const { requireAdminModule } = await compileAdminModules("admin-session-publication-tests", [
  "src/admin/api/client.ts",
  "src/admin/api/sessionStorage.ts",
  "src/admin/app/publicationPolling.ts",
  "src/admin/app/publishActionHandlers.ts",
  "src/admin/app/session.ts",
  "src/admin/core/publication.ts",
]);

const { loadAdminOperationalState } = requireAdminModule("api/client");
const { readPasswordSessionFromLocation } = requireAdminModule("api/sessionStorage");
const {
  createAdminPublicationPoller,
  getNextPublicationPollingDelay,
} = requireAdminModule("app/publicationPolling");
const { handlePublishAction } = requireAdminModule("app/publishActionHandlers");
const { createAdminSessionController } = requireAdminModule("app/session");
const { getPublicationTransitionStatus } = requireAdminModule("core/publication");

test("startup state load skips the deployment probe when publication is terminal", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json(createState());
  };

  try {
    const state = await loadAdminOperationalState(apiConfig(), authSession());

    assert.equal(state.publication.phase, "up_to_date");
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://example.supabase.co/rest/v1/rpc/get_admin_operational_state",
    );
    assert.equal(requests[0].init.method, "POST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit canonical reconciliation probes terminal state for rollbacks", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let stateReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });

    if (url.endsWith("/publish-menu-changes/status")) {
      return Response.json({ ok: true, status: "confirmed" });
    }

    stateReads += 1;
    return Response.json(createState({
      publication: { phase: stateReads === 1 ? "up_to_date" : "changes_pending" },
    }));
  };

  try {
    const state = await loadAdminOperationalState(apiConfig(), authSession(), true);

    assert.equal(state.publication.phase, "changes_pending");
    assertPublishingRequestSequence(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("publication polling reads, probes, and rereads canonical state when the probe is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const timers = createFakeTimers();
  let stateReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });

    if (url.endsWith("/publish-menu-changes/status")) {
      return Response.json({ ok: false, status: "unavailable" }, { status: 503 });
    }

    stateReads += 1;
    return Response.json(stateReads === 1
      ? createState({ publication: publishingState() })
      : createState());
  };
  const poller = createAdminPublicationPoller({
    async loadPublicationState() {
      return (await loadAdminOperationalState(apiConfig(), authSession())).publication;
    },
    isVisible: () => true,
    onError: assert.fail,
    onDelayed: assert.fail,
    setTimer: timers.set,
    clearTimer: timers.clear,
  });

  try {
    poller.start(publishingState());
    await waitForRequestCount(requests, 3);

    assertPublishingRequestSequence(requests);
    assert.equal(timers.size(), 0);
  } finally {
    poller.stop();
    globalThis.fetch = originalFetch;
  }
});

test("publication polling slows down after three minutes and continues until terminal state", async () => {
  const timers = createFakeTimers();
  const delays = [];
  let loads = 0;
  let delayedNotices = 0;
  let terminal = false;
  const poller = createAdminPublicationPoller({
    async loadPublicationState() {
      loads += 1;
      return terminal ? createState().publication : publishingState();
    },
    isVisible: () => true,
    onError: assert.fail,
    onDelayed() {
      delayedNotices += 1;
    },
    now: () => Date.parse("2026-08-12T12:03:00Z"),
    setTimer(callback, delayMs) {
      delays.push(delayMs);
      return timers.set(callback, delayMs);
    },
    clearTimer: timers.clear,
  });

  poller.start(publishingState());
  await flushAsyncWork();

  while (loads < 22) {
    timers.runNext();
    await flushAsyncWork();
  }

  assert.equal(delayedNotices, 1);
  assert.deepEqual(delays, [
    ...Array(12).fill(5_000),
    ...Array(8).fill(15_000),
    ...Array(2).fill(60_000),
  ]);

  terminal = true;
  timers.runNext();
  await flushAsyncWork();

  assert.equal(loads, 23);
  assert.equal(delayedNotices, 1);
  assert.equal(timers.size(), 0);
});

test("publication polling schedules a read no later than the server expiry", () => {
  const expiresAt = "2026-08-12T12:15:00Z";

  assert.equal(
    getNextPublicationPollingDelay(21, expiresAt, Date.parse("2026-08-12T12:14:45Z")),
    15_000,
  );
  assert.equal(
    getNextPublicationPollingDelay(21, expiresAt, Date.parse("2026-08-12T12:16:00Z")),
    5_000,
  );
});

test("publication polling pauses while hidden and resumes immediately", async () => {
  const timers = createFakeTimers();
  let visible = false;
  let loads = 0;
  const poller = createAdminPublicationPoller({
    async loadPublicationState() {
      loads += 1;
      return publishingState();
    },
    isVisible: () => visible,
    onError: assert.fail,
    onDelayed: assert.fail,
    setTimer: timers.set,
    clearTimer: timers.clear,
  });

  poller.start(publishingState());
  await flushAsyncWork();
  assert.equal(loads, 0);

  visible = true;
  poller.resume();
  await flushAsyncWork();
  assert.equal(loads, 1);
  assert.equal(timers.size(), 1);

  visible = false;
  poller.pause();
  assert.equal(timers.size(), 0);

  visible = true;
  poller.resume();
  await flushAsyncWork();
  assert.equal(loads, 2);

  poller.stop();
  assert.equal(timers.size(), 0);
});

test("publication polling can defer its first read after a fresh server load", async () => {
  const timers = createFakeTimers();
  let loads = 0;
  const poller = createAdminPublicationPoller({
    async loadPublicationState() {
      loads += 1;
      return publishingState();
    },
    isVisible: () => true,
    onError: assert.fail,
    onDelayed: assert.fail,
    setTimer: timers.set,
    clearTimer: timers.clear,
  });

  poller.start(publishingState(), false);
  await flushAsyncWork();

  assert.equal(loads, 0);
  assert.equal(timers.size(), 1);

  timers.runNext();
  await flushAsyncWork();
  assert.equal(loads, 1);

  poller.stop();
});

test("publication polling stops on terminal state and preserves state on network errors", async () => {
  const timers = createFakeTimers();
  const states = [
    new TypeError("network failed"),
    createState().publication,
  ];
  let errors = 0;
  const poller = createAdminPublicationPoller({
    async loadPublicationState() {
      const state = states.shift();

      if (state instanceof Error) {
        throw state;
      }

      return state;
    },
    isVisible: () => true,
    onError() {
      errors += 1;
    },
    onDelayed: assert.fail,
    setTimer: timers.set,
    clearTimer: timers.clear,
  });

  poller.start(publishingState());
  await flushAsyncWork();
  assert.equal(errors, 1);
  assert.equal(timers.size(), 1);

  timers.runNext();
  await flushAsyncWork();
  assert.equal(errors, 1);
  assert.equal(timers.size(), 0);
});

test("publication terminal transitions announce success and failure automatically", () => {
  const publishing = publishingState();

  assert.deepEqual(
    getPublicationTransitionStatus(publishing, createState().publication),
    { text: "Menú publicado correctamente.", tone: "success" },
  );
  assert.deepEqual(
    getPublicationTransitionStatus(
      publishing,
      createState({ publication: { phase: "changes_pending" } }).publication,
    ),
    {
      text: "Menú publicado correctamente. Hay cambios nuevos pendientes.",
      tone: "success",
    },
  );
  assert.deepEqual(
    getPublicationTransitionStatus(
      publishing,
      createState({ publication: { phase: "failed", can_retry: true } }).publication,
    ),
    { text: "No se pudo publicar. Tus cambios siguen guardados.", tone: "danger" },
  );
});

test("publish action follows canonical state and never relies on browser storage", async () => {
  const browser = installBrowser("https://example.com/admin/");
  let publications = 0;
  let confirmations = 0;
  browser.confirm = () => {
    confirmations += 1;
    return true;
  };
  globalThis.window.confirm = browser.confirm;
  const context = {
    formState: { confirmUnsavedChanges: () => true },
    getCurrentState: () => createState({ publication: { phase: "changes_pending" } }),
    adminOperations: {
      async publishChanges() {
        publications += 1;
      },
    },
  };

  await handlePublishAction(context);
  assert.equal(publications, 1);
  assert.equal(confirmations, 1);

  context.getCurrentState = () => createState({ publication: { phase: "publishing" } });
  await handlePublishAction(context);
  context.getCurrentState = () => createState({ publication: { phase: "failed", can_retry: false } });
  await handlePublishAction(context);

  assert.equal(publications, 1);
  assert.equal(confirmations, 1);
  assert.equal(browser.sessionStorage.size, 0);
  assert.equal(browser.localStorage.size, 0);
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

test("logout and failed refresh stop publication polling", async () => {
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

test("authenticated session startup requests one canonical reconciliation", async () => {
  const browser = installBrowser("https://example.com/admin/");
  browser.sessionStorage.setItem(sessionStorageKey, JSON.stringify({
    ...authSession(),
    expiresAt: Date.now() + 120_000,
  }));
  const context = createSessionContext(() => undefined);
  let loadArguments = null;
  context.loadAdminState = async (...args) => {
    loadArguments = args;
    return createState();
  };
  const controller = createAdminSessionController(context);

  try {
    await controller.start(() => assert.fail("configuration should be valid"));
    assert.deepEqual(loadArguments, [undefined, "neutral", "view", true]);
  } finally {
    uninstallBrowser();
  }
});

function createSessionContext(stopPublicationPolling) {
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
    stopPublicationPolling,
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

  get size() {
    return this.#values.size;
  }
}

function publishingState() {
  return createState({
    publication: {
      phase: "publishing",
      requested_at: "2026-08-12T12:00:00Z",
      expires_at: "2026-08-12T12:15:00Z",
    },
  }).publication;
}

function apiConfig() {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-key",
  };
}

function authSession() {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 60_000,
  };
}

function assertPublishingRequestSequence(requests) {
  assert.equal(requests.length, 3);
  assert.equal(
    requests[0].url,
    "https://example.supabase.co/rest/v1/rpc/get_admin_operational_state",
  );
  assert.equal(requests[0].init.method, "POST");
  assert.equal(
    requests[1].url,
    "https://example.supabase.co/functions/v1/publish-menu-changes/status",
  );
  assert.equal(requests[1].init.method, "POST");
  assert.equal(requests[1].init.headers.apikey, "public-key");
  assert.equal(requests[1].init.headers.Authorization, "Bearer access-token");
  assert.equal(
    requests[2].url,
    "https://example.supabase.co/rest/v1/rpc/get_admin_operational_state",
  );
  assert.equal(requests[2].init.method, "POST");
}

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();

  return {
    set(callback, delayMs) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, delayMs });
      return id;
    },
    clear(id) {
      timers.delete(id);
    },
    runNext() {
      const entry = timers.entries().next().value;
      assert.ok(entry, "a timer should be scheduled");
      const [id, timer] = entry;
      timers.delete(id);
      timer.callback();
    },
    size() {
      return timers.size;
    },
  };
}

async function flushAsyncWork() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

async function waitForRequestCount(requests, expectedCount) {
  for (let attempt = 0; attempt < 20 && requests.length < expectedCount; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
