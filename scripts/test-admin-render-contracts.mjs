import assert from "node:assert/strict";
import test from "node:test";
import {
  compileAdminModules,
  createCatalogItem,
  createState,
  createTarget,
  createViewState,
} from "./test-admin-helpers.mjs";

const { requireAdminModule } = await compileAdminModules("admin-render-contracts-tests", [
  "src/admin/views/auth.ts",
  "src/admin/views/shell.ts",
  "src/admin/views/availability.ts",
  "src/admin/views/fixedMenu.ts",
  "src/admin/views/service.ts",
  "src/admin/core/contracts.ts",
  "src/admin/core/types.ts",
  "src/admin/core/viewState.ts",
]);

const authView = requireAdminModule("views/auth");
const shellView = requireAdminModule("views/shell");
const availabilityView = requireAdminModule("views/availability");
const fixedMenuView = requireAdminModule("views/fixedMenu");
const serviceView = requireAdminModule("views/service");
const { adminForms, adminActions } = requireAdminModule("core/contracts");
const { getAdminViewState, setAdminFilter } = requireAdminModule("core/viewState");

test("login view exposes the login form contract", () => {
  const html = authView.renderLoginView({
    isBusy: false,
    currentStatus: null,
    currentBusyText: null,
  });

  assert.ok(hasForm(html, adminForms.login));
});

test("admin shell tabs use the tab action contract", () => {
  const state = createState();
  const html = shellView.renderAdminShell({
    state,
    viewState: createViewState({ activeTab: "availability" }),
    tabs: [
      { id: "availability", label: "Disponibilidad" },
      { id: "account", label: "Cuenta" },
    ],
    tabContent: "<p>content</p>",
    currentStatus: null,
    currentBusyText: null,
    isBusy: false,
  });

  assert.ok(hasAction(html, adminActions.tab));
  assert.ok(html.includes('data-admin-tab="availability"'));
  assert.ok(html.includes('data-admin-tab="account"'));
});

test("availability view exposes set and clear overlay actions", () => {
  const html = availabilityView.renderAvailabilityTab(
    createState(),
    createViewState({
      availabilityProfileFilter: "corpo",
      availabilityGroupFilter: "section:guarniciones",
    }),
    false,
  );

  assert.ok(hasAction(html, adminActions.setOverlay));
  assert.ok(hasAction(html, adminActions.clearOverlay));
});

test("availability view selects staff default profile when no filter is set", () => {
  const html = availabilityView.renderAvailabilityTab(
    createState({
      staff: {
        ...createState().staff,
        default_availability_profile_id: "teleinde",
      },
    }),
    createViewState(),
    false,
  );

  assert.ok(html.includes('<option value="teleinde" selected>Teleinde</option>'));
  assert.ok(html.includes('data-family-key="family:teleinde:parrilla:Parrilla"'));
  assert.equal(html.includes('Menu <span class="admin-row__title-meta">- corpo</span>'), false);
});

test("availability profile filters stay linked in view state", () => {
  setAdminFilter("availability-profile", "teleinde");
  setAdminFilter("availability-group", "section:parrilla");

  let viewState = getAdminViewState();

  assert.equal(viewState.availabilityProfileFilter, "teleinde");
  assert.equal(viewState.hiddenAvailabilityProfileFilter, "teleinde");
  assert.equal(viewState.availabilityGroupFilter, "section:parrilla");

  setAdminFilter("hidden-availability-profile", "corpo");
  viewState = getAdminViewState();

  assert.equal(viewState.availabilityProfileFilter, "corpo");
  assert.equal(viewState.hiddenAvailabilityProfileFilter, "corpo");
  assert.equal(viewState.availabilityGroupFilter, "");
});

test("availability rows show item name with profile only", () => {
  const html = availabilityView.renderAvailabilityTab(
    createState(),
    createViewState({
      availabilityProfileFilter: "corpo",
      availabilityGroupFilter: "section:guarniciones",
    }),
    false,
  );

  assert.ok(html.includes('Papas <span class="admin-row__title-meta">- corpo</span>'));
  assert.equal(html.includes("Menú fijo · corpo · guarniciones"), false);
  assert.equal(html.includes("guarniciones · Papas"), false);
});

test("availability view renders hidden summary before filters", () => {
  const html = availabilityView.renderAvailabilityTab(
    createHiddenAvailabilityState(),
    createViewState({
      availabilityProfileFilter: "corpo",
      availabilityGroupFilter: "section:guarniciones",
    }),
    false,
  );
  const summaryIndex = html.indexOf("admin-availability-summary");
  const filtersIndex = html.indexOf('data-admin-filter="availability-profile"');

  assert.ok(summaryIndex > -1);
  assert.ok(filtersIndex > -1);
  assert.ok(summaryIndex < filtersIndex);
});

test("availability hidden summary follows profile filter and ignores group filter", () => {
  const state = createHiddenAvailabilityState();
  const guarnicionesHtml = availabilityView.renderAvailabilityTab(
    state,
    createViewState({
      availabilityProfileFilter: "teleinde",
      availabilityGroupFilter: "section:guarniciones",
    }),
    false,
  );
  const parrillaHtml = availabilityView.renderAvailabilityTab(
    state,
    createViewState({
      availabilityProfileFilter: "teleinde",
      availabilityGroupFilter: "section:parrilla",
    }),
    false,
  );
  const summaryHtml = getSummaryHtml(guarnicionesHtml);

  assert.equal(summaryHtml, getSummaryHtml(parrillaHtml));
  assert.ok(summaryHtml.includes("Items ocultos"));
  assert.ok(summaryHtml.includes("admin-availability-summary__header"));
  assert.ok(summaryHtml.includes(`data-admin-action="${adminActions.hiddenAvailabilityProfile}"`));
  assert.ok(summaryHtml.includes('data-current="true"'));
  assert.equal(summaryHtml.includes("Ver lista"), false);
  assert.ok(summaryHtml.includes("Corpo: 1"));
  assert.ok(summaryHtml.includes("Teleinde: 2"));
  assert.ok(summaryHtml.includes("admin-availability-chip-list"));
  assert.ok(summaryHtml.includes("admin-availability-chip"));
  assert.equal(summaryHtml.includes("Servicio activo"), false);
  assert.equal(summaryHtml.includes("Menu fijo"), false);
  assert.ok(summaryHtml.includes("Mostrar"));
  assert.ok(summaryHtml.includes(`data-admin-action="${adminActions.setOverlay}"`));
  assert.ok(summaryHtml.includes('data-available="true"'));
  assert.ok(summaryHtml.includes('data-family-key="family:teleinde:parrilla:Parrilla"'));
  assert.ok(summaryHtml.includes('data-target-key="teleinde/guarniciones/ensalada"'));
  assert.equal(summaryHtml.includes('data-target-key="corpo/guarniciones/papas"'), false);
  assert.equal(summaryHtml.includes("admin-availability-chip__profile"), false);
});

test("availability hidden summary profile filter selects one profile only", () => {
  const html = availabilityView.renderAvailabilityTab(
    createHiddenAvailabilityState(),
    createViewState({
      hiddenAvailabilityProfileFilter: "teleinde",
      availabilityProfileFilter: "corpo",
      availabilityGroupFilter: "section:guarniciones",
    }),
    false,
  );
  const summaryHtml = getSummaryHtml(html);

  assert.ok(summaryHtml.includes("Corpo: 1"));
  assert.ok(summaryHtml.includes("Teleinde: 2"));
  assert.ok(summaryHtml.includes('data-family-key="family:teleinde:parrilla:Parrilla"'));
  assert.ok(summaryHtml.includes('data-target-key="teleinde/guarniciones/ensalada"'));
  assert.equal(summaryHtml.includes('data-target-key="corpo/guarniciones/papas"'), false);
});

test("availability hidden summary chips show group labels", () => {
  const state = createHiddenAvailabilityLabelsState();
  const html = availabilityView.renderAvailabilityTab(
    state,
    createViewState({ hiddenAvailabilityProfileFilter: "corpo" }),
    false,
  );
  const summaryHtml = getSummaryHtml(html);

  assert.ok(summaryHtml.includes('admin-availability-chip__meta">Menu del dia</span>'));
  assert.ok(summaryHtml.includes('admin-availability-chip__meta">Guarniciones</span>'));
  assert.ok(summaryHtml.includes('admin-availability-chip__meta">Empanada</span>'));
  assert.ok(summaryHtml.includes('admin-availability-chip__meta">Ensaladas</span>'));
  assert.ok(summaryHtml.includes('admin-availability-chip__meta">Cafeteria</span>'));
  assert.ok(summaryHtml.includes('admin-availability-chip__meta">Bebidas</span>'));
  assert.ok(summaryHtml.includes('admin-availability-chip__meta">Principales</span>'));
  assert.ok(summaryHtml.includes('admin-availability-chip__meta">Promos cafeteria</span>'));
  assert.ok(summaryHtml.includes("Jamon y queso"));
  assert.ok(summaryHtml.includes('admin-availability-chip__meta">Tarta</span>'));
  assert.ok(summaryHtml.includes('admin-availability-chip__meta">Tarta</span>\n      <span class="admin-availability-chip__separator">-</span>\n      <span class="admin-availability-chip__title">Jamon y queso</span>'));
  assert.equal(summaryHtml.includes('admin-availability-chip__meta">Platos principales con guarnicion</span>'), false);
  assert.equal(summaryHtml.includes('admin-availability-chip__meta">Promociones cafeteria</span>'), false);
  assert.equal(summaryHtml.includes('admin-availability-chip__meta">Tortilla</span>'), false);
  assert.equal(summaryHtml.includes('admin-availability-chip__meta">Omelette</span>'), false);
});

test("availability hidden summary does not repeat tartas parent label", () => {
  const sectionId = "tartas-tortillas-omelettes";
  const state = createState({
    availability_targets: [
      createTarget("corpo", "catalog", sectionId, "tartas", "Tartas"),
      createTarget("corpo", "catalog", sectionId, "tartas-jamon-queso", "Tartas - Jamon y queso"),
    ],
    availability_overlays: [
      {
        menu_id: "corpo",
        section_id: sectionId,
        item_id: "tartas",
        available_override: false,
        updated_at: "2026-01-01T00:00:00Z",
      },
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
          ...createCatalogItem(sectionId, "tartas", "Tartas", ["jamon-queso"]),
          options: [
            {
              section_id: sectionId,
              item_id: "tartas",
              option_id: "jamon-queso",
              name: "Jamon y queso",
              order_index: 0,
            },
          ],
        },
      ],
    },
  });
  const html = availabilityView.renderAvailabilityTab(
    state,
    createViewState({ hiddenAvailabilityProfileFilter: "corpo" }),
    false,
  );
  const summaryHtml = getSummaryHtml(html);

  assert.ok(summaryHtml.includes('admin-availability-chip__title">Tartas</span>'));
  assert.equal(summaryHtml.includes('admin-availability-chip__meta">Tarta</span>\n      <span class="admin-availability-chip__separator">-</span>\n      <span class="admin-availability-chip__title">Tartas</span>'), false);
  assert.equal(summaryHtml.includes('admin-availability-chip__title">Jamon y queso</span>'), false);
});

test("availability hidden summary does not repeat empanadas parent label", () => {
  const state = createState({
    availability_targets: [
      createTarget("corpo", "catalog", "empanadas", "empanadas", "Empanadas"),
      createTarget("corpo", "catalog", "empanadas", "empanadas-carne", "Empanadas - Carne"),
    ],
    availability_overlays: [
      {
        menu_id: "corpo",
        section_id: "empanadas",
        item_id: "empanadas",
        available_override: false,
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        menu_id: "corpo",
        section_id: "empanadas",
        item_id: "empanadas-carne",
        available_override: false,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    catalog_editor: {
      sections: [{ section_id: "empanadas", title: "Empanadas", order_index: 0, item_count: 1 }],
      items: [
        {
          ...createCatalogItem("empanadas", "empanadas", "Empanadas", ["carne"]),
          options: [
            {
              section_id: "empanadas",
              item_id: "empanadas",
              option_id: "carne",
              name: "Carne",
              order_index: 0,
            },
          ],
        },
      ],
    },
  });
  const html = availabilityView.renderAvailabilityTab(
    state,
    createViewState({ hiddenAvailabilityProfileFilter: "corpo" }),
    false,
  );
  const summaryHtml = getSummaryHtml(html);

  assert.ok(summaryHtml.includes('admin-availability-chip__title">Empanadas</span>'));
  assert.equal(summaryHtml.includes('admin-availability-chip__meta">Empanadas</span>\n      <span class="admin-availability-chip__separator">-</span>\n      <span class="admin-availability-chip__title">Empanadas</span>'), false);
  assert.equal(summaryHtml.includes('admin-availability-chip__title">Carne</span>'), false);
});

test("availability hidden summary restores grill as a family when partially hidden", () => {
  const html = availabilityView.renderAvailabilityTab(
    createState({
      availability_overlays: [
        {
          menu_id: "teleinde",
          section_id: "parrilla",
          item_id: "vacio",
          available_override: false,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    }),
    createViewState({ hiddenAvailabilityProfileFilter: "teleinde" }),
    false,
  );
  const summaryHtml = getSummaryHtml(html);

  assert.ok(summaryHtml.includes('data-family-key="family:teleinde:parrilla:Parrilla"'));
  assert.ok(summaryHtml.includes('admin-availability-chip__meta">Parrilla</span>'));
  assert.equal(summaryHtml.includes('data-target-key="teleinde/parrilla/vacio"'), false);
});

test("availability hidden summary renders an empty state", () => {
  const html = availabilityView.renderAvailabilityTab(
    createState(),
    createViewState(),
    false,
  );

  assert.ok(getSummaryHtml(html).includes("No hay items ocultos."));
});

test("availability view renders catalog options as nested rows", () => {
  const sectionId = "tartas-tortillas-omelettes";
  const state = createState({
    availability_targets: [
      createTarget("corpo", "catalog", sectionId, "tartas", "Tartas"),
      createTarget("corpo", "catalog", sectionId, "tartas-jamon-queso", "Tartas - Jamon y queso"),
      createTarget("corpo", "catalog", sectionId, "tartas-jamon-verdeo", "Tartas - Jamon y verdeo"),
      createTarget("corpo", "catalog", sectionId, "tortilla", "Tortilla"),
      createTarget("corpo", "catalog", sectionId, "omelette-espinaca-muzzarella", "Omelette de espinaca y muzzarella"),
      createTarget("corpo", "catalog", sectionId, "omelette-jamon-queso", "Omelette de jamon y queso"),
    ],
    catalog_editor: {
      sections: [{ section_id: sectionId, title: "Tartas, tortillas y omelettes", order_index: 0, item_count: 4 }],
      items: [
        {
          ...createCatalogItem(sectionId, "tartas", "Tartas", ["jamon-queso", "jamon-verdeo"]),
          options: [
            {
              section_id: sectionId,
              item_id: "tartas",
              option_id: "jamon-queso",
              name: "Jamon y queso",
              order_index: 0,
            },
            {
              section_id: sectionId,
              item_id: "tartas",
              option_id: "jamon-verdeo",
              name: "Jamon y verdeo",
              order_index: 1,
            },
          ],
        },
        createCatalogItem(sectionId, "tortilla", "Tortilla", []),
        createCatalogItem(sectionId, "omelette-espinaca-muzzarella", "Omelette de espinaca y muzzarella", []),
        createCatalogItem(sectionId, "omelette-jamon-queso", "Omelette de jamon y queso", []),
      ],
    },
  });
  const html = availabilityView.renderAvailabilityTab(
    state,
    createViewState({
      availabilityProfileFilter: "corpo",
      availabilityGroupFilter: `section:${sectionId}`,
    }),
    false,
  );

  assert.ok(html.includes('data-target-key="corpo/tartas-tortillas-omelettes/tartas-jamon-queso"'));
  assert.ok(html.includes('class="admin-row admin-row--nested"'));
  assertOrder(html, [
    "Tartas",
    "Jamon y queso",
    "Jamon y verdeo",
    "Tortilla",
    "Omelette de espinaca y muzzarella",
    "Omelette de jamon y queso",
  ]);
});

test("fixed menu view exposes item, option, and price form contracts", () => {
  const state = createState();
  const itemHtml = fixedMenuView.renderFixedMenuTab(
    state,
    createViewState({ activeTab: "fixed", fixedSectionFilter: "guarniciones" }),
    false,
  );
  const optionHtml = fixedMenuView.renderFixedMenuTab(
    state,
    createViewState({ activeTab: "fixed", fixedSectionFilter: "empanadas" }),
    false,
  );

  assert.ok(hasForm(itemHtml, adminForms.catalogItem));
  assert.ok(hasForm(itemHtml, adminForms.catalogItemEdit));
  assert.ok(hasForm(optionHtml, adminForms.catalogOption));
  assert.ok(hasForm(optionHtml, adminForms.catalogOptionEdit));
  assert.ok(hasForm(optionHtml, adminForms.variantPrice));
  assert.ok(itemHtml.includes("admin-price-tag"));
  assert.equal(itemHtml.includes("opciones asociadas"), false);
  assert.equal(optionHtml.includes("admin-price-tag"), false);
});

test("fixed menu view marks catalog items with photos", () => {
  const state = createState({
    catalog_editor: {
      items: [
        createCatalogItem("guarniciones", "papas", "Papas", [], {
          pricing_key: "catalog:guarniciones:item:papas",
          price_amount: 20,
          has_image: true,
        }),
        createCatalogItem("guarniciones", "ensalada", "Ensalada", []),
      ],
    },
  });
  const html = fixedMenuView.renderFixedMenuTab(
    state,
    createViewState({ activeTab: "fixed", fixedSectionFilter: "guarniciones" }),
    false,
  );

  assert.ok(html.includes('<span class="admin-price-tag">Con foto</span>'));
  assert.ok(html.includes("tiene una foto asociada"));
  assert.equal(html.includes("2 fotos"), false);
});

test("fixed menu view splits tartas, tortillas, and omelettes filters", () => {
  const sectionId = "tartas-tortillas-omelettes";
  const state = createState({
    catalog_editor: {
      sections: [{ section_id: sectionId, title: "Tartas, tortillas y omelettes", order_index: 0, item_count: 4 }],
      items: [
        createCatalogItem(sectionId, "tartas", "Alpha", ["a"]),
        createCatalogItem(sectionId, "tortilla", "Beta", ["b"]),
        createCatalogItem(sectionId, "omelette-espinaca-muzzarella", "Gamma", ["c"]),
        createCatalogItem(sectionId, "omelette-jamon-queso", "Delta", ["d"]),
      ],
    },
  });
  const html = fixedMenuView.renderFixedMenuTab(
    state,
    createViewState({ activeTab: "fixed", fixedSectionFilter: "tortillas" }),
    false,
  );

  assert.ok(html.includes('<option value="tartas"'));
  assert.ok(html.includes('<option value="tortillas" selected>Tortillas</option>'));
  assert.ok(html.includes('<option value="omelettes"'));
  assert.ok(html.includes("Beta"));
  assert.equal(html.includes("Alpha"), false);
  assert.equal(html.includes("Gamma"), false);
  assert.equal(html.includes("Delta"), false);
  assert.ok(html.includes(`name="section_id" value="${sectionId}"`));
  assert.ok(html.includes('name="item_id" value="tortilla"'));
});

test("service view exposes daily menu and fixed price contracts", () => {
  const html = serviceView.renderServiceTab(
    createState(),
    createViewState({ activeTab: "service", activeServiceSection: "daily-menu" }),
    false,
  );

  assert.ok(hasForm(html, adminForms.dailyMenu));
  assert.ok(hasForm(html, adminForms.fixedPrice));
});

test("publish banner keeps publication actionable while a request is pending", () => {
  const pendingState = createState({
    publication: {
      has_unpublished_changes: true,
      publish_requested: false,
    },
  });
  const requestedState = createState({
    publication: {
      has_unpublished_changes: true,
      publish_requested: true,
    },
  });
  const deniedState = createState({
    permissions: {
      can_publish_menu: false,
    },
    publication: {
      has_unpublished_changes: true,
      publish_requested: false,
    },
  });

  assert.ok(hasAction(renderShell(pendingState), adminActions.publish));
  assert.ok(hasAction(renderShell(requestedState), adminActions.publish));
  assert.ok(renderShell(requestedState).includes("Reintentar publicación"));
  assert.equal(hasAction(renderShell(deniedState), adminActions.publish), false);
});

function renderShell(state) {
  return shellView.renderAdminShell({
    state,
    viewState: createViewState(),
    tabs: [{ id: "availability", label: "Disponibilidad" }],
    tabContent: "",
    currentStatus: null,
    currentBusyText: null,
    isBusy: false,
  });
}

function createHiddenAvailabilityState() {
  return createState({
    availability_overlays: [
      {
        menu_id: "corpo",
        section_id: "guarniciones",
        item_id: "papas",
        available_override: false,
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        menu_id: "teleinde",
        section_id: "parrilla",
        item_id: "vacio",
        available_override: false,
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        menu_id: "teleinde",
        section_id: "parrilla",
        item_id: "entrana",
        available_override: false,
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
}

function createHiddenAvailabilityLabelsState() {
  const targets = [
    createTarget("corpo", "daily-menu", "menu-del-dia", "main", "Menu del dia"),
    createTarget("corpo", "catalog", "guarniciones", "papas", "Papas"),
    createTarget("corpo", "catalog", "empanadas", "empanadas-carne", "Empanadas - Carne"),
    createTarget("corpo", "catalog", "ensaladas", "cesar", "Cesar"),
    createTarget("corpo", "catalog", "cafeteria", "cafe-chico", "Cafe chico"),
    createTarget("corpo", "catalog", "bebidas", "coca-cola", "Coca-Cola"),
    createTarget("corpo", "catalog", "platos-principales", "milanesa", "Milanesa"),
    createTarget("corpo", "catalog", "promociones", "combo-cafe", "Combo cafe"),
    createTarget("corpo", "catalog", "tartas-tortillas-omelettes", "tartas-jamon-queso", "Tartas - Jamon y queso"),
    createTarget("corpo", "catalog", "tartas-tortillas-omelettes", "tortilla", "Tortilla"),
    createTarget("corpo", "catalog", "tartas-tortillas-omelettes", "omelette-espinaca-muzzarella", "Omelette de espinaca y muzzarella"),
  ];

  return createState({
    availability_targets: targets,
    availability_overlays: targets.map((target) => ({
      menu_id: target.menu_id,
      section_id: target.section_id,
      item_id: target.item_id,
      available_override: false,
      updated_at: "2026-01-01T00:00:00Z",
    })),
    catalog_editor: {
      sections: [
        { section_id: "guarniciones", title: "Guarniciones", order_index: 0, item_count: 1 },
        { section_id: "empanadas", title: "Empanadas", order_index: 1, item_count: 1 },
        { section_id: "ensaladas", title: "Ensaladas", order_index: 2, item_count: 1 },
        { section_id: "cafeteria", title: "Cafeteria", order_index: 3, item_count: 1 },
        { section_id: "bebidas", title: "Bebidas", order_index: 4, item_count: 1 },
        { section_id: "platos-principales", title: "Platos principales con guarnicion", order_index: 5, item_count: 1 },
        { section_id: "promociones", title: "Promociones cafeteria", order_index: 6, item_count: 1 },
        { section_id: "tartas-tortillas-omelettes", title: "Tartas, tortillas y omelettes", order_index: 7, item_count: 3 },
      ],
      items: [
        createCatalogItem("empanadas", "empanadas", "Empanadas", ["carne"]),
        createCatalogItem("tartas-tortillas-omelettes", "tartas", "Tartas", ["jamon-queso"], {
          options: [
            {
              section_id: "tartas-tortillas-omelettes",
              item_id: "tartas",
              option_id: "jamon-queso",
              name: "Jamon y queso",
              order_index: 0,
            },
          ],
        }),
        createCatalogItem("tartas-tortillas-omelettes", "tortilla", "Tortilla", []),
        createCatalogItem("tartas-tortillas-omelettes", "omelette-espinaca-muzzarella", "Omelette de espinaca y muzzarella", []),
      ],
    },
  });
}

function getSummaryHtml(html) {
  const startIndex = html.indexOf("admin-availability-summary");
  const endIndex = html.indexOf('data-admin-filter="availability-profile"');

  assert.ok(startIndex > -1);
  assert.ok(endIndex > startIndex);

  return html.slice(startIndex, endIndex);
}

function hasForm(html, form) {
  return html.includes(`data-admin-form="${form}"`);
}

function hasAction(html, action) {
  return html.includes(`data-admin-action="${action}"`);
}

function assertOrder(text, values) {
  let lastIndex = -1;

  for (const value of values) {
    const index = text.indexOf(value);

    assert.ok(index > lastIndex, `${value} should appear after the previous value`);
    lastIndex = index;
  }
}
