#!/usr/bin/env -S bun run
/**
 * Provision e2e fixture users for the resolver / RLS / admin-only test suites.
 *
 * Creates (if missing) and grants roles for three users that the e2e harness
 * (`e2e/helpers.ts`) expects:
 *
 *   - E2E_OPERATOR_EMAIL       → role: operator
 *   - E2E_OPERATOR_ONLY_EMAIL  → role: operator (and ONLY operator)
 *   - E2E_ADMIN_EMAIL          → role: operator + admin
 *
 * Idempotent: skips users that already exist, skips role grants that already
 * exist. Auto-confirms email so CI does not need a mailbox.
 *
 * USAGE
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   E2E_OPERATOR_EMAIL=op@ex E2E_OPERATOR_PASSWORD=... \
 *   E2E_OPERATOR_ONLY_EMAIL=op2@ex E2E_OPERATOR_ONLY_PASSWORD=... \
 *   E2E_ADMIN_EMAIL=adm@ex E2E_ADMIN_PASSWORD=... \
 *   bun run scripts/provision-e2e-fixtures.ts
 *
 * The script never prints passwords. Missing user envs are skipped, not an error
 * — so CI can provision a subset (e.g. only operator) without choking.
 */
import { createClient, type User } from "@supabase/supabase-js";

type Spec = { envEmail: string; envPass: string; roles: ("operator" | "admin")[] };

const SPECS: Spec[] = [
  { envEmail: "E2E_OPERATOR_EMAIL", envPass: "E2E_OPERATOR_PASSWORD", roles: ["operator"] },
  { envEmail: "E2E_OPERATOR_ONLY_EMAIL", envPass: "E2E_OPERATOR_ONLY_PASSWORD", roles: ["operator"] },
  { envEmail: "E2E_ADMIN_EMAIL", envPass: "E2E_ADMIN_PASSWORD", roles: ["operator", "admin"] },
];

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  for (const spec of SPECS) {
    const email = process.env[spec.envEmail];
    const pass = process.env[spec.envPass];
    if (!email || !pass) {
      console.log(`· ${spec.envEmail}: not set, skipping`);
      continue;
    }

    let user: User | null = null;

    // 1) Find existing.
    const { data: list, error: listErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listErr) {
      console.error(`  listUsers failed: ${listErr.message}`);
      process.exit(1);
    }
    user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;

    // 2) Create if missing.
    if (!user) {
      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email,
        password: pass,
        email_confirm: true,
      });
      if (createErr) {
        console.error(`  ${email}: createUser failed: ${createErr.message}`);
        continue;
      }
      user = created.user;
      console.log(`  ${email}: created (user_id=${user!.id})`);
    } else {
      console.log(`  ${email}: exists (user_id=${user.id})`);
    }

    // 3) Grant roles.
    for (const role of spec.roles) {
      const { error: insErr } = await sb
        .from("user_roles")
        .insert({ user_id: user!.id, role });
      if (insErr) {
        if ((insErr as { code?: string }).code === "23505") {
          console.log(`    role ${role}: already granted`);
        } else {
          console.error(`    role ${role}: insert failed: ${insErr.message}`);
        }
      } else {
        console.log(`    role ${role}: granted`);
      }
    }
  }

  console.log("done.");
}

if (import.meta.main) {
  await main();
}
