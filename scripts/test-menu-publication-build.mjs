import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  readVercelBuildBinding,
  runMenuPublicationBuild,
} from "./build-menu-publication.mjs";
import {
  createMenuPublicationChildEnvironment,
  parseMenuPublicationBuildTargetRows,
  parseMenuPublicationRevisionRows,
  readMenuPublicationBuildMetadata,
} from "../src/utils/menuPublicationBuild.mjs";
import { rowsFromPublicationSnapshot } from "../src/utils/menuSupabaseSnapshot.mjs";

const repoRoot = process.cwd();
const revisionId = "123e4567-e89b-12d3-a456-426614174000";
const contentHash = "0123456789abcdef0123456789abcdef";
const rawSnapshot = {
  profiles: [{ id: "corpo" }],
  profile_facts: [{ profile_id: "corpo", fact_id: "pagos" }],
  prices: [{ pricing_key: "daily", kind: "fixed", amount: 100 }],
  price_variants: [],
  daily_items: [{ item_id: "menu-del-dia" }],
  profile_service_settings: [{ profile_id: "corpo", service_kind: "daily-menu" }],
  catalog_sections: [{ section_id: "bebidas" }],
  catalog_items: [{ section_id: "bebidas", item_id: "agua" }],
  catalog_item_images: [{ catalog_item_id: 1, image_path: "/uploads/menu/agua.webp" }],
  catalog_item_options: [{ catalog_item_id: 1, option_id: "grande" }],
  grill_families: [{ family_id: "cortes" }],
  grill_items: [{ family_id: "cortes", item_id: "asado" }],
};

test("publication build target accepts one complete immutable revision", () => {
  assert.deepEqual(
    parseMenuPublicationBuildTargetRows([{
      request_id: "42",
      revision_id: revisionId.toUpperCase(),
      content_hash: contentHash,
      snapshot_version: 1,
    }]),
    {
      requestId: "42",
      revisionId,
      contentHash,
      snapshotVersion: 1,
    },
  );
});

test("publication build target fails closed on missing, ambiguous, or invalid rows", () => {
  const validRow = {
    request_id: null,
    revision_id: revisionId,
    content_hash: contentHash,
    snapshot_version: 1,
  };

  assert.throws(
    () => parseMenuPublicationBuildTargetRows([]),
    /exactly one row/,
  );
  assert.throws(
    () => parseMenuPublicationBuildTargetRows([validRow, validRow]),
    /exactly one row/,
  );
  assert.throws(
    () => parseMenuPublicationBuildTargetRows([{ ...validRow, revision_id: "draft" }]),
    /revision ID is invalid/,
  );
  assert.throws(
    () => parseMenuPublicationBuildTargetRows([{ ...validRow, content_hash: "bad" }]),
    /content hash is invalid/,
  );
  assert.throws(
    () => parseMenuPublicationBuildTargetRows([{ ...validRow, snapshot_version: 2 }]),
    /snapshot version is unsupported/,
  );
});

test("child-only publication metadata round-trips without exposing database credentials", () => {
  const target = parseMenuPublicationBuildTargetRows([{
    request_id: null,
    revision_id: revisionId,
    content_hash: contentHash,
    snapshot_version: 1,
  }]);
  const childEnvironment = createMenuPublicationChildEnvironment(
    { PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
    target,
  );

  assert.equal(childEnvironment.MENU_PUBLICATION_REQUEST_ID, "");
  assert.equal(childEnvironment.MENU_PUBLICATION_REVISION_ID, revisionId);
  assert.equal(childEnvironment.MENU_PUBLICATION_CONTENT_HASH, contentHash);
  assert.equal(childEnvironment.MENU_PUBLICATION_SNAPSHOT_VERSION, "1");
  assert.deepEqual(readMenuPublicationBuildMetadata(childEnvironment), {
    requestId: null,
    revisionId,
    contentHash,
    snapshotVersion: 1,
    deploymentId: undefined,
  });
});

test("revision rows must match the target before content is accepted", () => {
  const target = {
    requestId: "42",
    revisionId,
    contentHash,
    snapshotVersion: 1,
  };
  const validRevision = {
    revision_id: revisionId,
    content_hash: contentHash,
    snapshot_version: 1,
    content_snapshot: rawSnapshot,
  };

  assert.equal(
    parseMenuPublicationRevisionRows([validRevision], target),
    validRevision,
  );
  assert.throws(
    () => parseMenuPublicationRevisionRows([], target),
    /exactly one row/,
  );
  assert.throws(
    () => parseMenuPublicationRevisionRows([
      { ...validRevision, content_hash: "fedcba9876543210fedcba9876543210" },
    ], target),
    /does not match/,
  );
});

test("snapshot version one maps every canonical SQL collection", () => {
  const rows = rowsFromPublicationSnapshot(rawSnapshot, 1);

  assert.deepEqual(rows.profiles, rawSnapshot.profiles);
  assert.deepEqual(rows.facts, rawSnapshot.profile_facts);
  assert.deepEqual(rows.prices, rawSnapshot.prices);
  assert.deepEqual(rows.priceVariants, rawSnapshot.price_variants);
  assert.deepEqual(rows.dailyItems, rawSnapshot.daily_items);
  assert.deepEqual(rows.profileServiceSettings, rawSnapshot.profile_service_settings);
  assert.deepEqual(rows.catalogSections, rawSnapshot.catalog_sections);
  assert.deepEqual(rows.catalogItems, rawSnapshot.catalog_items);
  assert.deepEqual(rows.catalogItemImages, rawSnapshot.catalog_item_images);
  assert.deepEqual(rows.catalogItemOptions, rawSnapshot.catalog_item_options);
  assert.deepEqual(rows.grillFamilies, rawSnapshot.grill_families);
  assert.deepEqual(rows.grillItems, rawSnapshot.grill_items);
  assert.throws(
    () => rowsFromPublicationSnapshot({ ...rawSnapshot, grill_items: undefined }, 1),
    /field is invalid: grill_items/,
  );
  assert.throws(
    () => rowsFromPublicationSnapshot(rawSnapshot, 2),
    /version is unsupported/,
  );
});

test("build wrapper fails before Astro when the private database URL is absent", async () => {
  await assert.rejects(
    () => runMenuPublicationBuild({}),
    /Private Supabase database URL is required/,
  );
});

test("Vercel build binding is complete in Vercel and optional elsewhere", () => {
  assert.deepEqual(readVercelBuildBinding({}), {
    deploymentId: null,
    projectId: null,
  });
  assert.deepEqual(readVercelBuildBinding({
    VERCEL_DEPLOYMENT_ID: "dpl_example",
    VERCEL_PROJECT_ID: "prj_example",
  }), {
    deploymentId: "dpl_example",
    projectId: "prj_example",
  });
  assert.deepEqual(readVercelBuildBinding({ VERCEL_PROJECT_ID: "prj_edge_function" }), {
    deploymentId: null,
    projectId: null,
  });
  assert.throws(
    () => readVercelBuildBinding({ VERCEL_DEPLOYMENT_ID: "dpl_example" }),
    /must be provided together/,
  );
  assert.throws(
    () => readVercelBuildBinding({ VERCEL: "1" }),
    /system environment variables.*required/,
  );
  assert.throws(
    () => readVercelBuildBinding({
      VERCEL: "1",
      VERCEL_DEPLOYMENT_ID: "deployment-example",
      VERCEL_PROJECT_ID: "prj_example",
    }),
    /deployment ID is invalid/,
  );
  assert.throws(
    () => readVercelBuildBinding({
      VERCEL: "1",
      VERCEL_DEPLOYMENT_ID: "dpl_example",
      VERCEL_PROJECT_ID: "project-example",
    }),
    /project ID is invalid/,
  );
});

test("build, validator, loader, and admin keep their source boundaries", async () => {
  const [packageSource, wrapperSource, validatorSource, scriptLoaderSource, astroLoaderSource, adminSource] =
    await Promise.all([
      readFile(path.join(repoRoot, "package.json"), "utf8"),
      readFile(path.join(repoRoot, "scripts", "build-menu-publication.mjs"), "utf8"),
      readFile(path.join(repoRoot, "scripts", "validate-menu-supabase.mjs"), "utf8"),
      readFile(path.join(repoRoot, "scripts", "menu-content-supabase.mjs"), "utf8"),
      readFile(path.join(repoRoot, "src", "utils", "menuSupabaseContent.ts"), "utf8"),
      readFile(path.join(repoRoot, "src", "pages", "admin", "index.astro"), "utf8"),
    ]);
  const packageManifest = JSON.parse(packageSource);

  assert.equal(
    packageManifest.scripts.build,
    "node scripts/validate-build-env.mjs && node scripts/build-menu-publication.mjs",
  );
  assert.match(wrapperSource, /get_menu_publication_build_target/);
  assert.match(wrapperSource, /spawnSync\(process\.execPath/);
  assert.doesNotMatch(wrapperSource, /shell\s*:\s*true/);
  assert.match(validatorSource, /loadSupabaseMenuSnapshot/);
  assert.match(scriptLoaderSource, /loadRows/);
  assert.match(astroLoaderSource, /get_menu_publication_revision/);
  assert.match(astroLoaderSource, /import\.meta\.env\.DEV/);
  assert.match(adminSource, /data-publication-request-id/);
  assert.match(adminSource, /data-publication-revision-id/);
  assert.match(adminSource, /data-deployed-content-hash=\{deployedContentHash\}/);
  assert.match(adminSource, /data-publication-content-hash=\{deployedContentHash\}/);
  assert.match(adminSource, /data-vercel-deployment-id/);
});
