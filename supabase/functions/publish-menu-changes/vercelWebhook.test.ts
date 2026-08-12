import {
  createCanonicalProbeEvidenceEventId,
  getPublishFunctionRoute,
  parseCanonicalAdminUrl,
  parsePublicationArtifact,
  parseVercelPromotionEvent,
  verifyVercelWebhookSignature,
} from "./vercelWebhook.ts";

const nowMs = Date.parse("2026-08-12T12:00:00.000Z");
const expectedProjectId = "prj_Project123";
const expectedTeamId = "team_Team123";

Deno.test("routes the three publish-menu-changes surfaces without aliases", () => {
  assertEquals(
    getPublishFunctionRoute("/functions/v1/publish-menu-changes"),
    "publish",
  );
  assertEquals(
    getPublishFunctionRoute("/functions/v1/publish-menu-changes/status/"),
    "status",
  );
  assertEquals(
    getPublishFunctionRoute("/publish-menu-changes/vercel-webhook"),
    "vercel_webhook",
  );
  assertEquals(
    getPublishFunctionRoute("/publish-menu-changes/status/extra"),
    "not_found",
  );
  assertEquals(
    getPublishFunctionRoute("/functions/v1/other-function/vercel-webhook"),
    "not_found",
  );
});

Deno.test("accepts only a fixed canonical HTTPS admin URL", () => {
  assertEquals(
    parseCanonicalAdminUrl("https://elfaraoncatering.com.ar/admin/"),
    {
      url: "https://elfaraoncatering.com.ar/admin/",
      hostname: "elfaraoncatering.com.ar",
    },
  );

  for (const value of [
    "http://elfaraoncatering.com.ar/admin/",
    "https://user:secret@elfaraoncatering.com.ar/admin/",
    "https://elfaraoncatering.com.ar:8443/admin/",
    "https://elfaraoncatering.com.ar/admin/?deployment=dpl_Attacker",
    "https://elfaraoncatering.com.ar/admin/#status",
    "https://elfaraoncatering.com.ar/admin",
    "https://localhost/admin/",
  ]) {
    assertEquals(parseCanonicalAdminUrl(value), null);
  }
});

Deno.test("creates a bounded append-only evidence ID for each canonical observation", () => {
  const firstObservation = createCanonicalProbeEvidenceEventId(
    "dpl_Deployment123",
    "123e4567-e89b-42d3-a456-426614174000",
  );
  const secondObservation = createCanonicalProbeEvidenceEventId(
    "dpl_Deployment123",
    "223e4567-e89b-42d3-a456-426614174000",
  );

  assertEquals(
    firstObservation,
    "canonical:dpl_Deployment123:123e4567-e89b-42d3-a456-426614174000",
  );
  assert(firstObservation !== secondObservation, "Expected observations to have unique IDs.");
  assert(
    typeof firstObservation === "string"
      && firstObservation.length <= 256
      && /^[A-Za-z0-9:_-]+$/.test(firstObservation),
    "Expected the evidence ID to satisfy the database contract.",
  );
  assertEquals(
    createCanonicalProbeEvidenceEventId(
      `dpl_${"a".repeat(201)}`,
      "123e4567-e89b-42d3-a456-426614174000",
    ),
    null,
  );
  assertEquals(
    createCanonicalProbeEvidenceEventId("dpl_Deployment123", "not-a-uuid"),
    null,
  );
});

Deno.test("verifies the Vercel HMAC-SHA1 signature over the raw body", async () => {
  const body = new TextEncoder().encode('{"type":"deployment.promoted"}\n');
  const signature = await createSignature(body, "webhook-secret");

  assert(
    await verifyVercelWebhookSignature(body, signature, "webhook-secret"),
    "Expected the matching signature to be accepted.",
  );
  assert(
    !await verifyVercelWebhookSignature(
      new TextEncoder().encode('{"type":"deployment.promoted"}'),
      signature,
      "webhook-secret",
    ),
    "Expected a body mutation to invalidate the signature.",
  );
  assert(
    !await verifyVercelWebhookSignature(body, "not-hex", "webhook-secret"),
    "Expected malformed signatures to be rejected.",
  );
});

Deno.test("accepts a recent deployment.promoted event for the configured binding", () => {
  const result = parseVercelPromotionEvent(
    createPromotionEvent(),
    expectedProjectId,
    expectedTeamId,
    nowMs,
  );

  assert(result.accepted, "Expected the promotion event to be accepted.");

  if (result.accepted) {
    assertEquals(result.event, {
      eventId: "evt_Event123",
      eventCreatedAt: "2026-08-12T12:00:00.000Z",
      deploymentId: "dpl_Deployment123",
      deploymentHost: "el-faraon-abc123.vercel.app",
      projectId: expectedProjectId,
      teamId: expectedTeamId,
    });
  }
});

Deno.test("rejects promotion events outside the configured security binding", () => {
  const mismatches = [
    createPromotionEvent({ projectId: "prj_OtherProject" }),
    createPromotionEvent({ teamId: "team_OtherTeam" }),
    createPromotionEvent({ target: "preview" }),
    createPromotionEvent({ deploymentId: "not-a-deployment" }),
    createPromotionEvent({ deploymentHost: "vercel.app.attacker.example" }),
    createPromotionEvent({ deploymentHost: "https://el-faraon-abc123.vercel.app" }),
    createPromotionEvent({ createdAt: nowMs - (25 * 60 * 60 * 1000) - 1 }),
    createPromotionEvent({ createdAt: nowMs + (5 * 60 * 1000) + 1 }),
  ];

  for (const event of mismatches) {
    const result = parseVercelPromotionEvent(
      event,
      expectedProjectId,
      expectedTeamId,
      nowMs,
    );

    assert(!result.accepted, "Expected the mismatched event to be rejected.");
  }
});

Deno.test("accepts an absent team only when no team binding is configured", () => {
  const event = createPromotionEvent({ teamId: null });

  assert(
    parseVercelPromotionEvent(event, expectedProjectId, null, nowMs).accepted,
    "Expected an account event without a team to be accepted when unbound.",
  );
  assert(
    !parseVercelPromotionEvent(event, expectedProjectId, expectedTeamId, nowMs).accepted,
    "Expected a missing team to fail a configured team binding.",
  );
});

Deno.test("extracts canonical immutable publication metadata from the admin artifact", () => {
  const artifact = parsePublicationArtifact(`
    <main
      data-publication-request-id="42"
      data-publication-revision-id="123E4567-E89B-12D3-A456-426614174000"
      data-publication-content-hash="11111111111111111111111111111111"
      data-vercel-deployment-id="dpl_Deployment123"
    ></main>
  `);

  assertEquals(artifact, {
    requestId: "42",
    revisionId: "123e4567-e89b-12d3-a456-426614174000",
    contentHash: "11111111111111111111111111111111",
    deploymentId: "dpl_Deployment123",
  });
});

Deno.test("accepts an absent or empty publication request ID for normal builds", () => {
  const artifactWithoutRequest = `
    <main
      data-publication-revision-id="123e4567-e89b-12d3-a456-426614174000"
      data-publication-content-hash="11111111111111111111111111111111"
      data-vercel-deployment-id="dpl_Deployment123"
    ></main>
  `;
  const artifactWithEmptyRequest = artifactWithoutRequest.replace(
    "<main",
    '<main data-publication-request-id=""',
  );
  const artifactWithInvalidRequest = artifactWithoutRequest.replace(
    "<main",
    '<main data-publication-request-id="not-a-request"',
  );

  assertEquals(parsePublicationArtifact(artifactWithoutRequest)?.requestId, null);
  assertEquals(parsePublicationArtifact(artifactWithEmptyRequest)?.requestId, null);
  assertEquals(parsePublicationArtifact(artifactWithInvalidRequest), null);
});

Deno.test("allows matching legacy artifact aliases but rejects conflicting metadata", () => {
  const matchingArtifact = `
    <main
      data-publication-request-id="42"
      data-publication-revision-id="123e4567-e89b-12d3-a456-426614174000"
      data-publication-content-hash="11111111111111111111111111111111"
      data-deployed-content-hash="11111111111111111111111111111111"
      data-vercel-deployment-id="dpl_Deployment123"
      data-publication-deployment-id="dpl_Deployment123"
    ></main>
  `;
  const conflictingArtifact = matchingArtifact.replace(
    'data-deployed-content-hash="11111111111111111111111111111111"',
    'data-deployed-content-hash="22222222222222222222222222222222"',
  );

  assert(parsePublicationArtifact(matchingArtifact) !== null, "Expected matching aliases.");
  assertEquals(parsePublicationArtifact(conflictingArtifact), null);
});

interface PromotionOverrides {
  createdAt?: number | string;
  deploymentHost?: string;
  deploymentId?: string;
  projectId?: string;
  target?: string;
  teamId?: string | null;
}

const createPromotionEvent = (overrides: PromotionOverrides = {}) => ({
  id: "evt_Event123",
  type: "deployment.promoted",
  createdAt: overrides.createdAt ?? nowMs,
  payload: {
    deployment: {
      id: overrides.deploymentId ?? "dpl_Deployment123",
      url: overrides.deploymentHost ?? "el-faraon-abc123.vercel.app",
    },
    project: {
      id: overrides.projectId ?? expectedProjectId,
    },
    team: overrides.teamId === null
      ? null
      : { id: overrides.teamId ?? expectedTeamId },
    ...(overrides.target === undefined ? {} : { target: overrides.target }),
  },
});

const createSignature = async (body: Uint8Array, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const bodyBuffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(bodyBuffer).set(body);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, bodyBuffer));

  return Array.from(signature, (value) => value.toString(16).padStart(2, "0")).join("");
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEquals = (actual: unknown, expected: unknown): void => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}.`);
  }
};
