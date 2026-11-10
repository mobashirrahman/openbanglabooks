/**
 * Update only the hosted Supabase "Confirm signup" and "Reset password"
 * email templates, leaving every other auth setting (providers, secrets,
 * redirect URLs, SMTP) untouched.
 *
 * Create a personal access token at
 * https://supabase.com/dashboard/account/tokens, then run from the repo root:
 *
 *   read -rsp "Supabase access token: " SUPABASE_ACCESS_TOKEN; echo
 *   export SUPABASE_ACCESS_TOKEN
 *   pnpm exec tsx scripts/update-hosted-email-templates.ts
 *   unset SUPABASE_ACCESS_TOKEN
 *
 * Add --dry-run to see what would change without writing anything. The token
 * is read from the environment and never printed or stored.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "mfelvlzokrzknfujiroq";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const DRY_RUN = process.argv.includes("--dry-run");

const SUBJECTS = {
  confirmation: "আপনার অ্যাকাউন্ট নিশ্চিত করুন · OpenBanglaBooks",
  recovery: "পাসওয়ার্ড রিসেট · OpenBanglaBooks",
} as const;

const FIELDS = {
  confirmation: {
    subject: "mailer_subjects_confirmation",
    content: "mailer_templates_confirmation_content",
  },
  recovery: {
    subject: "mailer_subjects_recovery",
    content: "mailer_templates_recovery_content",
  },
} as const;

type AuthConfig = Record<string, unknown>;

function api(method: "GET" | "PATCH", body?: AuthConfig) {
  return fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function main() {
  if (!TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN is not set");

  const root = process.cwd();
  const confirmation = readFileSync(join(root, "supabase/templates/confirm-signup.html"), "utf8");
  const recovery = readFileSync(join(root, "supabase/templates/recovery.html"), "utf8");

  const beforeResponse = await api("GET");
  if (!beforeResponse.ok) {
    throw new Error(`Could not read the hosted auth config (${beforeResponse.status}): ${(await beforeResponse.text()).slice(0, 400)}`);
  }
  const before = (await beforeResponse.json()) as AuthConfig;

  // Keep only the fields this script replaces, so the backup has no secrets.
  const backup = {
    project: PROJECT_REF,
    saved_at: new Date().toISOString(),
    confirmation_subject: before[FIELDS.confirmation.subject],
    confirmation_content: before[FIELDS.confirmation.content],
    recovery_subject: before[FIELDS.recovery.subject],
    recovery_content: before[FIELDS.recovery.content],
  };
  const backupPath = join(tmpdir(), `openbanglabooks-email-templates-${Date.now()}.json`);
  writeFileSync(backupPath, JSON.stringify(backup, null, 2), { mode: 0o600 });
  console.log(`old templates backed up to ${backupPath}`);

  const patch: AuthConfig = {
    [FIELDS.confirmation.subject]: SUBJECTS.confirmation,
    [FIELDS.confirmation.content]: confirmation,
    [FIELDS.recovery.subject]: SUBJECTS.recovery,
    [FIELDS.recovery.content]: recovery,
  };

  if (DRY_RUN) {
    console.log("dry run: would update");
    console.log(`  ${FIELDS.confirmation.subject} / ${FIELDS.confirmation.content}`);
    console.log(`  ${FIELDS.recovery.subject} / ${FIELDS.recovery.content}`);
    return;
  }

  const updateResponse = await api("PATCH", patch);
  if (!updateResponse.ok) {
    throw new Error(`Could not update the templates (${updateResponse.status}): ${(await updateResponse.text()).slice(0, 400)}`);
  }

  const after = (await (await api("GET")).json()) as AuthConfig;
  const ok =
    after[FIELDS.confirmation.subject] === SUBJECTS.confirmation &&
    after[FIELDS.recovery.subject] === SUBJECTS.recovery &&
    after[FIELDS.confirmation.content] === confirmation &&
    after[FIELDS.recovery.content] === recovery;

  if (!ok) throw new Error("The update returned success but the stored templates do not match");
  console.log("hosted email templates updated:");
  console.log(`  confirm signup: ${SUBJECTS.confirmation}`);
  console.log(`  reset password: ${SUBJECTS.recovery}`);
}

void main();
