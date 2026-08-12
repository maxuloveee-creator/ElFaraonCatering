import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);

export async function compileAdminModules(name, entryFiles) {
  const tempRoot = join(tmpdir(), `el-faraon-${name}-${process.pid}`);
  const outDir = join(tempRoot, "out");
  const tsconfigPath = join(tempRoot, "tsconfig.json");

  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true });
  await writeFile(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "CommonJS",
        moduleResolution: "Node",
        ignoreDeprecations: "6.0",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        outDir,
        rootDir: repoRoot,
        lib: ["ES2022", "DOM"],
      },
      include: entryFiles.map((file) => join(repoRoot, file)),
    }),
    "utf8",
  );

  const tscPath = join(repoRoot, "node_modules/typescript/bin/tsc");
  execFileSync(process.execPath, [tscPath, "-p", tsconfigPath], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  return {
    requireAdminModule(moduleName) {
      return require(join(outDir, "src/admin", `${moduleName}.js`));
    },
  };
}

export function createState(overrides = {}) {
  const state = {
    ok: true,
    message: "ok",
    staff: {
      user_id: "user-1",
      display_name: "Operador",
      role: "operator",
      profile_id: null,
      default_availability_profile_id: null,
      active: true,
    },
    permissions: {
      can_edit_availability: true,
      can_edit_menu_content: true,
      can_publish_menu: true,
      can_manage_staff: false,
    },
    profiles: [
      { id: "corpo", eyebrow: "", title: "Corpo", description: "", can_edit_availability: true },
      { id: "teleinde", eyebrow: "", title: "Teleinde", description: "", can_edit_availability: true },
    ],
    service_settings: [
      { profile_id: "corpo", service_kind: "daily-menu" },
      { profile_id: "teleinde", service_kind: "grill" },
    ],
    daily_menu: [
      {
        item_id: "menu-del-dia",
        name: "Menu regular",
        description: "Principal",
        pricing_key: "menu-del-dia",
        order_index: 0,
      },
      {
        item_id: "menu-vegetariano-del-dia",
        name: "Menu vegetariano",
        description: null,
        pricing_key: "menu-vegetariano-del-dia",
        order_index: 1,
      },
    ],
    availability_targets: [
      createTarget("corpo", "daily-menu", "menu-del-dia", "main", "Menu"),
      createTarget("corpo", "grill", "parrilla", "bife", "Bife", "Parrilla"),
      createTarget("corpo", "catalog", "guarniciones", "papas", "Papas"),
      createTarget("teleinde", "daily-menu", "menu-del-dia", "main", "Menu"),
      createTarget("teleinde", "grill", "parrilla", "vacio", "Vacio", "Parrilla"),
      createTarget("teleinde", "grill", "parrilla", "entrana", "Entrana", "Parrilla"),
      createTarget("teleinde", "catalog", "guarniciones", "ensalada", "Ensalada"),
    ],
    availability_overlays: [
      {
        menu_id: "corpo",
        section_id: "guarniciones",
        item_id: "papas",
        available_override: true,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    prices: {
      fixed: [
        { pricing_key: "menu-del-dia", amount: 100 },
        { pricing_key: "menu-vegetariano-del-dia", amount: 90 },
        { pricing_key: "catalog:guarniciones:item:papas", amount: 20 },
      ],
      variants: [
        {
          pricing_key: "catalog:empanadas:item:empanadas",
          variant_id: "docena",
          name: "Docena",
          amount: 120,
          order_index: 0,
        },
      ],
    },
    grill_editor: {
      families: [{ family_id: "parrilla", title: "Parrilla", order_index: 0, item_count: 2 }],
      items: [
        {
          family_id: "parrilla",
          family_title: "Parrilla",
          item_id: "vacio",
          name: "Vacio",
          variant_name: "Vacio",
          pricing_key: "vacio",
          price_amount: 10,
          order_index: 0,
        },
        {
          family_id: "parrilla",
          family_title: "Parrilla",
          item_id: "entrana",
          name: "Entrana",
          variant_name: "Entrana",
          pricing_key: "entrana",
          price_amount: 12,
          order_index: 1,
        },
      ],
    },
    catalog_editor: {
      sections: [
        { section_id: "empanadas", title: "Empanadas", order_index: 0, item_count: 2 },
        { section_id: "guarniciones", title: "Guarniciones", order_index: 1, item_count: 2 },
      ],
      items: [
        createCatalogItem("empanadas", "empanadas", "Empanadas", ["carne", "pollo"], {
          pricing_key: "catalog:empanadas:item:empanadas",
        }),
        createCatalogItem("empanadas", "otro", "Otro", []),
        createCatalogItem("guarniciones", "papas", "Papas", [], {
          pricing_key: "catalog:guarniciones:item:papas",
          price_amount: 20,
        }),
        createCatalogItem("guarniciones", "guarnicion-sola", "Guarnicion sola", []),
      ],
    },
    publication: {
      phase: "up_to_date",
      has_newer_changes: false,
      can_retry: false,
      requested_at: null,
      expires_at: null,
    },
  };

  return mergeState(state, overrides);
}

export function createTarget(menuId, kind, sectionId, itemId, name, groupTitle = null) {
  return {
    menu_id: menuId,
    profile_title: menuId,
    target_kind: kind,
    section_id: sectionId,
    section_title: sectionId,
    group_title: groupTitle,
    item_id: itemId,
    name,
    description: null,
    base_available: true,
    price_amount: null,
  };
}

export function createCatalogItem(sectionId, itemId, name, optionIds, overrides = {}) {
  return {
    section_id: sectionId,
    section_title: sectionId,
    item_id: itemId,
    name,
    description: null,
    pricing_key: `${sectionId}-${itemId}`,
    price_amount: null,
    order_index: 0,
    has_image: false,
    option_count: optionIds.length,
    options: optionIds.map((optionId, index) => ({
      section_id: sectionId,
      item_id: itemId,
      option_id: optionId,
      name: optionId,
      order_index: index,
    })),
    ...overrides,
  };
}

export function createViewState(overrides = {}) {
  return {
    activeTab: "availability",
    activeServiceSection: "active-service",
    availabilityProfileFilter: "",
    availabilityGroupFilter: "",
    hiddenAvailabilityProfileFilter: "",
    fixedSectionFilter: "",
    ...overrides,
  };
}

export function createForm(fields) {
  return {
    __adminTestFields: Object.entries(fields).flatMap(([name, value]) => {
      const values = Array.isArray(value) ? value : [value];
      return values.map((entry) => [name, String(entry)]);
    }),
  };
}

export function installMockFormData() {
  const OriginalFormData = globalThis.FormData;

  class TestFormData {
    #fields;

    constructor(form) {
      this.#fields = form?.__adminTestFields ?? [];
    }

    get(name) {
      const entry = this.#fields.find(([fieldName]) => fieldName === name);
      return entry?.[1] ?? null;
    }

    getAll(name) {
      return this.#fields
        .filter(([fieldName]) => fieldName === name)
        .map((entry) => entry[1]);
    }
  }

  globalThis.FormData = TestFormData;

  return () => {
    globalThis.FormData = OriginalFormData;
  };
}

export function okResult(overrides = {}) {
  return {
    ok: true,
    changed: true,
    requires_redeploy: false,
    operation: "test",
    message: "ok",
    ...overrides,
  };
}

function mergeState(state, overrides) {
  const next = { ...state, ...overrides };

  for (const key of ["permissions", "prices", "grill_editor", "catalog_editor", "publication"]) {
    if (overrides[key]) {
      next[key] = { ...state[key], ...overrides[key] };
    }
  }

  return next;
}
