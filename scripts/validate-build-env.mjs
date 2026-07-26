import { loadLocalEnv } from "./load-local-env.mjs";

const requiredPublicEnvNames = [
  "PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_ANON_KEY",
];

loadLocalEnv();

const missingEnvNames = requiredPublicEnvNames.filter(
  (name) => !process.env[name]?.trim(),
);

if (missingEnvNames.length > 0) {
  console.error(`Build environment is missing required variables: ${missingEnvNames.join(", ")}.`);
  process.exit(1);
}

console.log("Required public build environment is configured.");
