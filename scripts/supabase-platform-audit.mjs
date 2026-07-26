const protectedSchemaProbes = [
  { schema: "app_private", table: "menu_change_events" },
  { schema: "menu_content", table: "menu_profiles" },
];

export async function auditProtectedSchemasNotExposed({
  supabaseUrl,
  supabaseAnonKey,
  fetchImpl = fetch,
}) {
  const normalizedSupabaseUrl = supabaseUrl.replace(/\/+$/, "");
  const failures = [];

  for (const probe of protectedSchemaProbes) {
    let response;

    try {
      response = await fetchImpl(
        `${normalizedSupabaseUrl}/rest/v1/${probe.table}?select=*&limit=0`,
        {
          headers: {
            apikey: supabaseAnonKey,
            "Accept-Profile": probe.schema,
          },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`Data API exposure probe failed for ${probe.schema}: ${message}`);
      continue;
    }

    const body = await readJsonBody(response);

    if (response.status !== 406 || body?.code !== "PGRST106") {
      const code = typeof body?.code === "string" ? body.code : "unknown";
      failures.push(
        `Protected schema ${probe.schema} did not return PGRST106 (status ${response.status}, code ${code}).`,
      );
    }
  }

  return failures;
}

async function readJsonBody(response) {
  try {
    const body = await response.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}
