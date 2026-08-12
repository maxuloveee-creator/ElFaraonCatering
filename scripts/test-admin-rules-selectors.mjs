import assert from "node:assert/strict";
import test from "node:test";
import { compileAdminModules, createCatalogItem, createState, createTarget } from "./test-admin-helpers.mjs";

const { requireAdminModule } = await compileAdminModules("admin-rules-selectors-tests", [
  "src/admin/app/availabilityActionHandlers.ts",
  "src/admin/core/rules.ts",
  "src/admin/core/selectors.ts",
  "src/admin/core/types.ts",
  "src/admin/core/adminState.ts",
]);

const availabilityActionHandlers = requireAdminModule("app/availabilityActionHandlers");
const rules = requireAdminModule("core/rules");
const selectors = requireAdminModule("core/selectors");
const adminState = requireAdminModule("core/adminState");

test("admin state preserves the canonical server publication contract", () => {
  const publication = {
    phase: "publishing",
    has_newer_changes: true,
    can_retry: false,
    requested_at: "2026-08-12T12:00:00Z",
    expires_at: "2026-08-12T12:15:00Z",
  };

  assert.deepEqual(
    adminState.normalizeAdminState(createState({ publication })).publication,
    publication,
  );
});

test("admin state fails closed for malformed publication state", () => {
  const normalized = adminState.normalizeAdminState(createState({
    publication: {
      phase: "unknown",
      has_newer_changes: "yes",
      can_retry: "yes",
      requested_at: "",
      expires_at: "",
    },
  }));

  assert.deepEqual(normalized.publication, {
    phase: "failed",
    has_newer_changes: false,
    can_retry: false,
    requested_at: null,
    expires_at: null,
  });
});

test("availability targets match each profile active service", () => {
  const state = createState();
  const targetKeys = selectors.getVisibleAvailabilityTargets(state).map((target) =>
    `${target.menu_id}:${target.target_kind}:${target.item_id}`
  );

  assert.deepEqual(targetKeys, [
    "corpo:daily-menu:main",
    "corpo:catalog:papas",
    "teleinde:grill:vacio",
    "teleinde:grill:entrana",
    "teleinde:catalog:ensalada",
  ]);
});

test("hidden availability targets include both profiles and only false visible overlays", () => {
  const state = createState({
    availability_overlays: [
      {
        menu_id: "corpo",
        section_id: "guarniciones",
        item_id: "papas",
        available_override: false,
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        menu_id: "corpo",
        section_id: "parrilla",
        item_id: "bife",
        available_override: false,
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        menu_id: "teleinde",
        section_id: "parrilla",
        item_id: "vacio",
        available_override: true,
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        menu_id: "teleinde",
        section_id: "guarniciones",
        item_id: "ensalada",
        available_override: false,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
  });

  assert.deepEqual(selectors.getHiddenAvailabilityTargets(state).map((target) => adminState.getTargetKey(target)), [
    "corpo/guarniciones/papas",
    "teleinde/guarniciones/ensalada",
  ]);
});

test("availability grouping collapses grill and keeps catalog groups", () => {
  const state = createState();
  const teleindeTargets = selectors.getVisibleAvailabilityTargets(state).filter((target) =>
    target.menu_id === "teleinde"
  );

  assert.deepEqual(selectors.getAvailabilityGroupOptions(teleindeTargets), [
    { key: "section:parrilla", label: "Parrilla" },
    { key: "section:guarniciones", label: "guarniciones" },
  ]);
});

test("invalid availability filters fall back to first editable profile and group", () => {
  const state = createState();
  const effectiveProfileFilter = selectors.getEffectiveAvailabilityProfileFilter(state, "missing-profile");
  const profileTargets = selectors.getVisibleAvailabilityTargets(state).filter((target) =>
    target.menu_id === effectiveProfileFilter
  );
  const effectiveGroupFilter = selectors.getEffectiveAvailabilityGroupFilter(
    selectors.getAvailabilityGroupOptions(profileTargets),
    "missing-group",
  );
  const targets = profileTargets.filter((target) =>
    selectors.getAvailabilityGroupKey(target) === effectiveGroupFilter
  );

  assert.equal(effectiveProfileFilter, "corpo");
  assert.equal(effectiveGroupFilter, "section:menu-del-dia");
  assert.deepEqual(targets.map((target) => adminState.getTargetKey(target)), [
    "corpo/menu-del-dia/main",
  ]);
});

test("availability profile filter falls back to staff default profile", () => {
  const state = createState({
    staff: {
      ...createState().staff,
      default_availability_profile_id: "teleinde",
    },
  });
  const effectiveProfileFilter = selectors.getEffectiveAvailabilityProfileFilter(state, "");
  const profileTargets = selectors.getVisibleAvailabilityTargets(state).filter((target) =>
    target.menu_id === effectiveProfileFilter
  );
  const effectiveGroupFilter = selectors.getEffectiveAvailabilityGroupFilter(
    selectors.getAvailabilityGroupOptions(profileTargets),
    "",
  );
  const targets = profileTargets.filter((target) =>
    selectors.getAvailabilityGroupKey(target) === effectiveGroupFilter
  );

  assert.equal(effectiveProfileFilter, "teleinde");
  assert.equal(effectiveGroupFilter, "section:parrilla");
  assert.deepEqual(targets.map((target) => adminState.getTargetKey(target)), [
    "teleinde/parrilla/vacio",
    "teleinde/parrilla/entrana",
  ]);
});

test("fixed options-only sections expose only allowed items", () => {
  const state = createState();
  const section = selectors.getEffectiveFixedSection(state.catalog_editor, "empanadas");
  const items = selectors.getFixedLocationItems(state.catalog_editor, section);

  assert.equal(rules.getFixedMenuEditMode(section), "options-only");
  assert.deepEqual(items.map((item) => item.item_id), ["empanadas"]);
});

test("combined tartas section is split into fixed menu admin locations", () => {
  const sectionId = "tartas-tortillas-omelettes";
  const state = createState({
    catalog_editor: {
      sections: [{ section_id: sectionId, title: "Tartas, tortillas y omelettes", order_index: 0, item_count: 4 }],
      items: [
        createCatalogItem(sectionId, "tartas", "Tartas", ["jamon-queso"]),
        createCatalogItem(sectionId, "tortilla", "Tortilla", []),
        createCatalogItem(sectionId, "omelette-espinaca-muzzarella", "Omelette de espinaca y muzzarella", []),
        createCatalogItem(sectionId, "omelette-jamon-queso", "Omelette de jamon y queso", []),
      ],
    },
  });

  assert.deepEqual(rules.getFixedMenuLocations(state.catalog_editor.sections).map((section) => section.filter_id), [
    "tartas",
    "tortillas",
    "omelettes",
  ]);

  const section = selectors.getEffectiveFixedSection(state.catalog_editor, "tortillas");
  const items = selectors.getFixedLocationItems(state.catalog_editor, section);

  assert.equal(section.section_id, sectionId);
  assert.equal(section.filter_id, "tortillas");
  assert.equal(section.title, "Tortillas");
  assert.equal(rules.getFixedMenuEditMode(section), "options-only");
  assert.deepEqual(items.map((item) => item.item_id), ["tortilla"]);

  const omelettesSection = selectors.getEffectiveFixedSection(state.catalog_editor, "omelettes");
  const omeletteItems = selectors.getFixedLocationItems(state.catalog_editor, omelettesSection);

  assert.equal(omelettesSection.section_id, sectionId);
  assert.equal(omelettesSection.filter_id, "omelettes");
  assert.equal(omelettesSection.title, "Omelettes");
  assert.equal(rules.getFixedMenuEditMode(omelettesSection), "options-only");
  assert.deepEqual(omeletteItems.map((item) => item.item_id), [
    "omelette-espinaca-muzzarella",
    "omelette-jamon-queso",
  ]);
});

test("missing fixed section filter falls back to first section", () => {
  const state = createState();
  const section = selectors.getEffectiveFixedSection(state.catalog_editor, "missing-section");

  assert.equal(section.section_id, "empanadas");
});

test("side option rules hide prices for included sides only", () => {
  const state = createState();
  const guarniciones = selectors.getEffectiveFixedSection(state.catalog_editor, "guarniciones");
  const papas = selectors.findCatalogItem(state, "guarniciones", "papas");
  const guarnicionSola = selectors.findCatalogItem(state, "guarniciones", "guarnicion-sola");

  assert.equal(rules.catalogItemFormRequiresPrice(guarniciones), false);
  assert.equal(rules.isIncludedSideOptionItem(papas), true);
  assert.equal(rules.isIncludedSideOptionItem(guarnicionSola), false);
});

test("delete controls are allowed only when another item remains", () => {
  assert.equal(rules.canDeleteFromList(2), true);
  assert.equal(rules.canDeleteFromList(1), false);
});

test("allowed tabs follow permissions and always include account", () => {
  assert.deepEqual(rules.getAllowedTabs(createState()).map((tab) => tab.id), [
    "availability",
    "service",
    "fixed",
    "account",
  ]);

  assert.deepEqual(
    rules.getAllowedTabs(createState({
      permissions: {
        can_edit_availability: false,
        can_edit_menu_content: false,
        can_publish_menu: false,
      },
    })).map((tab) => tab.id),
    ["account"],
  );

  assert.deepEqual(
    rules.getAllowedTabs(createState({
      permissions: {
        can_edit_availability: true,
        can_edit_menu_content: false,
      },
    })).map((tab) => tab.id),
    ["availability", "account"],
  );
});

test("service sections are available only when active in at least one profile", () => {
  const state = createState();

  assert.equal(rules.isServiceSectionAvailable(state, "active-service"), true);
  assert.equal(rules.isServiceSectionAvailable(state, "daily-menu"), true);
  assert.equal(rules.isServiceSectionAvailable(state, "grill"), true);

  const noServicesState = createState({ service_settings: [] });

  assert.equal(rules.isServiceSectionAvailable(noServicesState, "active-service"), true);
  assert.equal(rules.isServiceSectionAvailable(noServicesState, "daily-menu"), false);
  assert.equal(rules.isServiceSectionAvailable(noServicesState, "grill"), false);
});

test("selectors find availability targets and grill family targets", () => {
  const state = createState();
  const target = selectors.findAvailabilityTarget(state, "teleinde/parrilla/vacio");
  const familyTargets = selectors.findAvailabilityFamilyTargets(state, "family:teleinde:parrilla:Parrilla");

  assert.equal(target.name, "Vacio");
  assert.deepEqual(familyTargets.map((entry) => entry.item_id), ["vacio", "entrana"]);
});

test("grill availability target actions apply to the whole family", async () => {
  const calls = [];
  const context = createAvailabilityActionContext(calls);

  await availabilityActionHandlers.handleSetOverlayAction(
    context,
    { dataset: { targetKey: "teleinde/parrilla/vacio", available: "false" } },
  );
  await availabilityActionHandlers.handleClearOverlayAction(
    context,
    { dataset: { targetKey: "teleinde/parrilla/vacio" } },
  );

  assert.deepEqual(calls, [
    ["saveBatch", ["vacio", "entrana"], false],
    ["clearBatch", ["vacio", "entrana"]],
  ]);
});

test("selectors do not resolve inactive service availability targets", () => {
  const state = createState();

  assert.equal(selectors.findAvailabilityTarget(state, "corpo/parrilla/bife"), undefined);
  assert.deepEqual(selectors.findAvailabilityFamilyTargets(state, "family:corpo:parrilla:Parrilla"), []);
});

test("selectors find catalog options and grill families", () => {
  const state = createState();

  assert.equal(selectors.findCatalogItemOption(state, "empanadas", "empanadas", "carne").name, "carne");
  assert.equal(selectors.findGrillFamily(state, "parrilla").title, "Parrilla");
  assert.equal(selectors.findGrillItem(state, "vacio").variant_name, "Vacio");
});

test("catalog availability cascade keeps parent and options synchronized", () => {
  const sectionId = "tartas-tortillas-omelettes";
  const parent = createTarget("corpo", "catalog", sectionId, "tartas", "Tartas");
  const jamon = createTarget("corpo", "catalog", sectionId, "tartas-jamon-queso", "Tartas - Jamon y queso");
  const verdeo = createTarget("corpo", "catalog", sectionId, "tartas-jamon-verdeo", "Tartas - Jamon y verdeo");
  const state = createState({
    availability_targets: [parent, jamon, verdeo],
    catalog_editor: {
      sections: [{ section_id: sectionId, title: "Tartas, tortillas y omelettes", order_index: 0, item_count: 1 }],
      items: [
        {
          ...createCatalogItem(sectionId, "tartas", "Tartas", ["jamon-queso", "jamon-verdeo"]),
          options: [
            { section_id: sectionId, item_id: "tartas", option_id: "jamon-queso", name: "Jamon y queso", order_index: 0 },
            { section_id: sectionId, item_id: "tartas", option_id: "jamon-verdeo", name: "Jamon y verdeo", order_index: 1 },
          ],
        },
      ],
    },
  });

  assert.deepEqual(
    selectors.buildCatalogAvailabilityCascade(state, parent, false).map((target) => adminState.getTargetKey(target)),
    [
      "corpo/tartas-tortillas-omelettes/tartas",
      "corpo/tartas-tortillas-omelettes/tartas-jamon-queso",
      "corpo/tartas-tortillas-omelettes/tartas-jamon-verdeo",
    ],
  );

  const oneHiddenState = createState({
    availability_targets: [parent, jamon, verdeo],
    availability_overlays: [
      {
        menu_id: "corpo",
        section_id: sectionId,
        item_id: "tartas-jamon-queso",
        available_override: false,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    catalog_editor: {
      sections: [{ section_id: sectionId, title: "Tartas, tortillas y omelettes", order_index: 0, item_count: 1 }],
      items: [
        {
          ...createCatalogItem(sectionId, "tartas", "Tartas", ["jamon-queso", "jamon-verdeo"]),
          options: [
            { section_id: sectionId, item_id: "tartas", option_id: "jamon-queso", name: "Jamon y queso", order_index: 0 },
            { section_id: sectionId, item_id: "tartas", option_id: "jamon-verdeo", name: "Jamon y verdeo", order_index: 1 },
          ],
        },
      ],
    },
  });

  assert.deepEqual(
    selectors.buildCatalogAvailabilityCascade(oneHiddenState, verdeo, false).map((target) => adminState.getTargetKey(target)),
    [
      "corpo/tartas-tortillas-omelettes/tartas-jamon-verdeo",
      "corpo/tartas-tortillas-omelettes/tartas",
    ],
  );

  assert.deepEqual(
    selectors.buildCatalogAvailabilityCascade(oneHiddenState, jamon, true).map((target) => adminState.getTargetKey(target)),
    [
      "corpo/tartas-tortillas-omelettes/tartas-jamon-queso",
      "corpo/tartas-tortillas-omelettes/tartas",
    ],
  );
});

function createAvailabilityActionContext(calls) {
  return {
    formState: {
      confirmUnsavedChanges() {
        return true;
      },
    },
    getCurrentState() {
      return createState();
    },
    setStatus(message, tone) {
      calls.push(["status", message, tone]);
    },
    adminOperations: {
      saveAvailabilityOverlay(target, available) {
        calls.push(["saveSingle", target.item_id, available]);
      },
      clearAvailabilityOverlay(target) {
        calls.push(["clearSingle", target.item_id]);
      },
      saveAvailabilityOverlayBatch(targets, available) {
        calls.push(["saveBatch", targets.map((target) => target.item_id), available]);
      },
      clearAvailabilityOverlayBatch(targets) {
        calls.push(["clearBatch", targets.map((target) => target.item_id)]);
      },
    },
  };
}
