import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createSupabasePostgresClient,
  sanitizeSupabasePostgresError,
} from "../src/utils/supabasePostgresClient.mjs";
import { loadLocalEnv } from "./load-local-env.mjs";
import { auditProtectedSchemasNotExposed } from "./supabase-platform-audit.mjs";

const privateAuditDatabaseUrlEnvName = ["SUPABASE", "AUDIT", "DB", "URL"].join("_");
const publicSupabaseUrlEnvName = "PUBLIC_SUPABASE_URL";
const publicSupabaseAnonKeyEnvName = "PUBLIC_SUPABASE_ANON_KEY";
const auditFiles = [
  "docs/supabase/audits/menu-schema-audit.sql",
  "docs/supabase/audits/database-audit.sql",
];
const successStatuses = new Set(["keep", "present"]);

loadLocalEnv();

const databaseUrl = process.env[privateAuditDatabaseUrlEnvName];
const publicSupabaseUrl = process.env[publicSupabaseUrlEnvName]?.trim();
const publicSupabaseAnonKey = process.env[publicSupabaseAnonKeyEnvName]?.trim();

if (!databaseUrl) {
  console.error("Private Supabase audit database URL is required for Supabase audits.");
  process.exit(1);
}

if (!publicSupabaseUrl || !publicSupabaseAnonKey) {
  console.error("Public Supabase URL and anon key are required for Data API exposure audits.");
  process.exit(1);
}

const sql = createSupabasePostgresClient(databaseUrl);

const failures = [];

try {
  for (const auditFile of auditFiles) {
    await runAuditFile(auditFile, failures);
  }

  failures.push(...(await auditProtectedSchemasNotExposed({
    supabaseUrl: publicSupabaseUrl,
    supabaseAnonKey: publicSupabaseAnonKey,
  })));
} finally {
  await sql.end();
}

if (failures.length > 0) {
  console.error("Supabase read-only audit failed:");

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  process.exit(1);
}

console.log(`Supabase read-only audit passed for ${auditFiles.length} files and the Data API exposure guard.`);

async function runAuditFile(auditFile, failures) {
  const auditPath = path.resolve(auditFile);
  const statements = splitSqlStatements(readFileSync(auditPath, "utf8"));

  console.log(`Running ${auditFile} (${statements.length} statements)...`);

  await sql.unsafe("begin read only");

  try {
    for (const [index, statement] of statements.entries()) {
      const label = getStatementLabel(statement, index);
      let rows;

      try {
        rows = await sql.unsafe(statement);
      } catch (error) {
        failures.push(`${auditFile} ${label}: query failed: ${sanitizeError(error)}`);
        break;
      }

      collectRiskRows(auditFile, label, rows, failures);
    }
  } finally {
    await sql.unsafe("rollback");
  }
}

function collectRiskRows(auditFile, label, rows, failures) {
  for (const row of rows) {
    const failureReason = getFailureReason(row);

    if (!failureReason) {
      continue;
    }

    failures.push(`${auditFile} ${label}: ${failureReason}: ${formatRow(row)}`);
  }
}

function getFailureReason(row) {
  if (isRiskStatus(row.suggested_status)) {
    return "suggested_status is risk";
  }

  if (isFailureStatus(row.status)) {
    return `status is ${row.status}`;
  }

  if (typeof row.diagnostic === "string" && row.diagnostic.length > 0) {
    return `diagnostic ${row.diagnostic}`;
  }

  return null;
}

function isRiskStatus(value) {
  return typeof value === "string" && value.toLowerCase() === "risk";
}

function isFailureStatus(value) {
  if (typeof value !== "string") {
    return false;
  }

  return !successStatuses.has(value.toLowerCase());
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let statementStart = 0;
  let quote = null;
  let dollarQuoteTag = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];
    const nextChar = sqlText[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (dollarQuoteTag) {
      if (sqlText.startsWith(dollarQuoteTag, index)) {
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      }
      continue;
    }

    if (quote) {
      if (char === quote) {
        if (sqlText[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "-" && nextChar === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "$") {
      const match = sqlText.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);

      if (match) {
        dollarQuoteTag = match[0];
        index += dollarQuoteTag.length - 1;
      }
      continue;
    }

    if (char === ";") {
      addStatement(statements, sqlText.slice(statementStart, index));
      statementStart = index + 1;
    }
  }

  addStatement(statements, sqlText.slice(statementStart));

  return statements;
}

function addStatement(statements, rawStatement) {
  const statement = rawStatement.trim();

  if (statement.length > 0) {
    statements.push(statement);
  }
}

function getStatementLabel(statement, index) {
  const commentMatch = statement.match(/^\s*--\s*(.+)$/m);

  return commentMatch ? commentMatch[1].trim() : `statement ${index + 1}`;
}

function formatRow(row) {
  return JSON.stringify(row, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

function sanitizeError(error) {
  return sanitizeSupabasePostgresError(error, databaseUrl, [publicSupabaseAnonKey]);
}
