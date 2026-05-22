#!/usr/bin/env -S bun run
/**
 * Bootstrap the first operator/admin for a fresh AWIP Core deployment.
 *
 * USAGE
 *   bun run scripts/bootstrap-admin.ts <email> [--role operator|admin]
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env. The email must
 * already exist in auth.users — sign the user up via the normal /auth flow
 * first, then run this to grant the role.
 *
 * Idempotent: if the user already holds the role this script is a no-op.
 * Every grant inserts a row into public.user_roles (the only legitimate
 * source of authorisation — never read role data from JWT custom claims or
 * client storage, see mem://preferences/verification-discipline).
 */
import { createClient } from "@supabase/supabase-js";

type Role = "operator" | "admin";

function parseArgs(): { email: string; role: Role } {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"));
  if (!email) {
    console.error("usage: bootstrap-admin.ts <email> [--role operator|admin]");
    process.exit(2);
  }
  const roleIdx = args.indexOf("--role");
  const role = (roleIdx >= 0 ? args[roleIdx + 1] : "operator") as Role;
  if (role !== "operator" && role !== "admin") {
    console.error(`invalid --role "${role}", must be operator or admin`);
    process.exit(2);
  }
  return { email, role };
}

async function main() {
  const { email, role } = parseArgs();
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env");
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 1. Look up the auth user by email via admin API.
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) {
    console.error("listUsers failed:", listErr.message);
    process.exit(1);
  }
  const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(
      `no auth user found for "${email}". Sign the user up via /auth first, then re-run.`,
    );
    process.exit(1);
  }

  // 2. Idempotent insert into user_roles.
  const { error: insErr } = await sb
    .from("user_roles")
    .insert({ user_id: user.id, role })
    .select("user_id, role")
    .single();

  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") {
      console.log(`✓ ${email} already has role "${role}" (no-op)`);
      return;
    }
    console.error("insert user_roles failed:", insErr.message);
    process.exit(1);
  }

  console.log(`✓ granted role "${role}" to ${email} (user_id=${user.id})`);
  console.log(
    "Verify with: select role from user_roles where user_id = '" + user.id + "';",
  );
}

if (import.meta.main) {
  await main();
}
