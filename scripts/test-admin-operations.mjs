import assert from "node:assert/strict";
import test from "node:test";
import {
  compileAdminModules,
  createForm,
  createState,
  installMockFormData,
  okResult,
} from "./test-admin-helpers.mjs";

const restoreFormData = installMockFormData();

test.after(() => {
  restoreFormData();
});

const { requireAdminModule } = await compileAdminModules("admin-operations-tests", [
  "src/admin/operations/index.ts",
  "src/admin/core/types.ts",
]);

const { createAdminOperations } = requireAdminModule("operations/index");

test("availability save calls set_menu_availability_overlay", async () => {
  const harness = createHarness();
  const operations = createAdminOperations(harness.context);
  const target = createState().availability_targets[0];

  await operations.saveAvailabilityOverlay(target, false);

  assert.deepEqual(harness.calls, [
    {
      name: "set_menu_availability_overlay",
      body: {
        menu_id: "corpo",
        section_id: "menu-del-dia",
        item_id: "main",
        available_override: false,
      },
    },
  ]);
  assert.equal(harness.busyTexts[0], "Ocultando item...");
  assert.equal(harness.loads[0].tone, "success");
});

test("availability clear calls clear_menu_availability_overlay", async () => {
  const harness = createHarness();
  const operations = createAdminOperations(harness.context);
  const target = createState().availability_targets[0];

  await operations.clearAvailabilityOverlay(target);

  assert.deepEqual(harness.calls, [
    {
      name: "clear_menu_availability_overlay",
      body: {
        menu_id: "corpo",
        section_id: "menu-del-dia",
        item_id: "main",
      },
    },
  ]);
  assert.equal(harness.busyTexts[0], "Quitando ajuste...");
});

test("availability batch save calls set_menu_availability_overlays once", async () => {
  const harness = createHarness();
  const operations = createAdminOperations(harness.context);
  const targets = createState().availability_targets.slice(0, 2);

  await operations.saveAvailabilityOverlayBatch(targets, false);

  assert.deepEqual(harness.calls, [
    {
      name: "set_menu_availability_overlays",
      body: {
        targets: [
          {
            menu_id: "corpo",
            section_id: "menu-del-dia",
            item_id: "main",
          },
          {
            menu_id: "corpo",
            section_id: "parrilla",
            item_id: "bife",
          },
        ],
        available_override: false,
      },
    },
  ]);
  assert.equal(harness.busyTexts[0], "Ocultando items...");
  assert.equal(harness.loads[0].tone, "success");
});

test("availability batch clear calls clear_menu_availability_overlays once", async () => {
  const harness = createHarness();
  const operations = createAdminOperations(harness.context);
  const targets = createState().availability_targets.slice(5, 7);

  await operations.clearAvailabilityOverlayBatch(targets);

  assert.deepEqual(harness.calls, [
    {
      name: "clear_menu_availability_overlays",
      body: {
        targets: [
          {
            menu_id: "teleinde",
            section_id: "parrilla",
            item_id: "entrana",
          },
          {
            menu_id: "teleinde",
            section_id: "guarniciones",
            item_id: "ensalada",
          },
        ],
      },
    },
  ]);
  assert.equal(harness.busyTexts[0], "Quitando ajuste...");
  assert.equal(harness.loads[0].tone, "success");
});

test("daily menu save calls set_daily_menu", async () => {
  const harness = createHarness();
  const operations = createAdminOperations(harness.context);

  await operations.saveDailyMenu(createForm({
    regular_name: "Milanesa",
    regular_description: "Con pure",
    vegetarian_name: "Tarta",
    vegetarian_description: "",
  }));

  assert.deepEqual(harness.calls, [
    {
      name: "set_daily_menu",
      body: {
        regular_name: "Milanesa",
        regular_description: "Con pure",
        vegetarian_name: "Tarta",
        vegetarian_description: null,
      },
    },
  ]);
  assert.equal(harness.loads[0].text, "Menú guardado.");
});

test("fixed price save calls set_global_fixed_price", async () => {
  const harness = createHarness();
  const operations = createAdminOperations(harness.context);

  await operations.saveFixedPrice(createForm({
    pricing_key: "catalog:guarniciones:item:papas",
    amount: "150",
  }));

  assert.deepEqual(harness.calls, [
    {
      name: "set_global_fixed_price",
      body: {
        pricing_key: "catalog:guarniciones:item:papas",
        amount: 150,
      },
    },
  ]);
});

test("publish queued reloads the canonical server state", async () => {
  const harness = createHarness({
    loadState: createState({
      publication: {
        phase: "publishing",
        requested_at: "2026-08-12T12:00:00Z",
      },
    }),
    publishResult: okResult({
      operation: "publish-menu-changes",
      message: "publish_queued",
    }),
  });
  const operations = createAdminOperations(harness.context);

  await operations.publishChanges();

  assert.equal(harness.requiredSessions, 1);
  assert.equal(harness.loads.length, 1);
  assert.deepEqual(harness.statuses, [
    { text: "Publicación en curso. Podés seguir trabajando.", tone: "neutral" },
  ]);
  assert.equal(harness.busyTexts[0], "Preparando publicación...");
});

test("already active publish reloads the same canonical server state", async () => {
  const harness = createHarness({
    loadState: createState({
      publication: {
        phase: "publishing",
        has_newer_changes: true,
        requested_at: "2026-08-12T12:00:00Z",
      },
    }),
    publishResult: okResult({
      operation: "publish-menu-changes",
      message: "publish_already_active",
    }),
  });
  const operations = createAdminOperations(harness.context);

  await operations.publishChanges();

  assert.equal(harness.requiredSessions, 1);
  assert.equal(harness.loads.length, 1);
  assert.deepEqual(harness.statuses, [
    { text: "Publicación en curso. Podés seguir trabajando.", tone: "neutral" },
  ]);
});

test("publish reload reports a canonical failure without losing changes", async () => {
  const harness = createHarness({
    loadState: createState({
      publication: {
        phase: "failed",
        can_retry: true,
        requested_at: "2026-08-12T12:00:00Z",
      },
    }),
  });
  const operations = createAdminOperations(harness.context);

  await operations.publishChanges();

  assert.equal(harness.loads.length, 1);
  assert.deepEqual(harness.statuses, [
    { text: "No se pudo publicar. Tus cambios siguen guardados.", tone: "danger" },
  ]);
});

test("publish request failure reloads server state before offering retry", async () => {
  const harness = createHarness({
    loadState: createState({
      publication: {
        phase: "failed",
        can_retry: true,
        requested_at: "2026-08-12T12:00:00Z",
      },
    }),
    publishError: new Error("No se pudo publicar."),
  });
  const operations = createAdminOperations(harness.context);

  await operations.publishChanges();

  assert.equal(harness.loads.length, 1);
  assert.deepEqual(harness.statuses, [
    { text: "No se pudo publicar. Tus cambios siguen guardados.", tone: "danger" },
  ]);
});

test("publish request failure keeps technical errors out of the operator flow", async () => {
  const harness = createHarness({
    loadState: createState({ publication: { phase: "changes_pending" } }),
    publishError: new Error("publish_not_configured"),
  });
  const operations = createAdminOperations(harness.context);

  await operations.publishChanges();

  assert.deepEqual(harness.statuses, [
    { text: "No se pudo publicar. Tus cambios siguen guardados.", tone: "danger" },
  ]);
});

test("partial mutation failure reports incomplete operation", async () => {
  const harness = createHarness({
    mutationResults: [
      okResult({ operation: "update_catalog_item", changed: true }),
      {
        ok: false,
        changed: false,
        requires_redeploy: false,
        operation: "set_global_fixed_price",
        message: "invalid_amount",
      },
    ],
  });
  const operations = createAdminOperations(harness.context);

  await assert.rejects(
    operations.saveCatalogItemEdit(createForm({
      section_id: "guarniciones",
      item_id: "papas",
      name: "Papas",
      description: "",
      fixed_pricing_key: "catalog:guarniciones:item:papas",
      fixed_price_amount: "120",
    })),
    /Algunos cambios pueden haberse guardado/,
  );

  assert.deepEqual(harness.calls.map((call) => call.name), [
    "update_catalog_item",
    "set_global_fixed_price",
  ]);
});

function createHarness(options = {}) {
  const calls = [];
  const loads = [];
  const busyTexts = [];
  const statuses = [];
  const mutationResults = [...(options.mutationResults ?? [])];
  const loadState = options.loadState ?? createState({
    publication: {
      phase: "publishing",
      requested_at: "2026-08-12T12:00:00Z",
    },
  });
  const harness = {
    calls,
    loads,
    busyTexts,
    statuses,
    requiredSessions: 0,
    context: {
      async runBusy(action, busyText) {
        busyTexts.push(busyText ?? "");
        await action();
      },
      async callMutation(name, body) {
        calls.push({ name, body });
        return mutationResults.shift() ?? okResult({ operation: name });
      },
      async loadAdminState(statusText, statusTone) {
        loads.push({
          text: typeof statusText === "function" ? statusText(loadState) : statusText,
          tone: statusTone,
        });
        return loadState;
      },
      setStatus(text, tone) {
        statuses.push({ text, tone });
      },
      async requireSession() {
        harness.requiredSessions += 1;
        return {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: Date.now() + 60_000,
        };
      },
      async publishMenuChanges() {
        if (options.publishError) {
          throw options.publishError;
        }

        return options.publishResult ?? okResult({ operation: "publish-menu-changes" });
      },
    },
  };

  return harness;
}
