// W10-S2 — approval-policy evaluator unit tests.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateApprovalPolicy,
  DEFAULT_APPROVAL_POLICIES,
} from "./approval-policy.ts";

const clean = { cleanParse: true, lawfulBasis: true };

Deno.test("operator / four_eyes always route to review", () => {
  assertEquals(evaluateApprovalPolicy("operator", {}, clean).lifecycle, "pending_review");
  assertEquals(evaluateApprovalPolicy("four_eyes", {}, clean).lifecycle, "pending_review");
});

Deno.test("auto with met conditions → auto_approved", () => {
  assertEquals(
    evaluateApprovalPolicy(
      "auto",
      { require_clean_parse: true, require_lawful_basis: true },
      clean,
    ).lifecycle,
    "auto_approved",
  );
});

Deno.test("auto blocks on a failed condition", () => {
  assertEquals(
    evaluateApprovalPolicy(
      "auto",
      { require_clean_parse: true, require_lawful_basis: true },
      { cleanParse: false, lawfulBasis: true },
    ).lifecycle,
    "pending_review",
  );
  assertEquals(
    evaluateApprovalPolicy(
      "auto",
      { require_clean_parse: true, require_lawful_basis: true },
      { cleanParse: true, lawfulBasis: false },
    ).lifecycle,
    "pending_review",
  );
});

Deno.test("auto with no conditions approves unconditionally", () => {
  assertEquals(
    evaluateApprovalPolicy("auto", {}, { cleanParse: false, lawfulBasis: false }).lifecycle,
    "auto_approved",
  );
});

Deno.test("seed policies: consequential classes need an operator, low-risk auto", () => {
  for (const cls of ["contract", "certificate", "register", "model", "drawing"] as const) {
    assertEquals(
      evaluateApprovalPolicy(
        DEFAULT_APPROVAL_POLICIES[cls].mode,
        DEFAULT_APPROVAL_POLICIES[cls].auto_conditions,
        clean,
      ).lifecycle,
      "pending_review",
    );
  }
  for (const cls of ["correspondence", "media", "other"] as const) {
    assertEquals(
      evaluateApprovalPolicy(
        DEFAULT_APPROVAL_POLICIES[cls].mode,
        DEFAULT_APPROVAL_POLICIES[cls].auto_conditions,
        clean,
      ).lifecycle,
      "auto_approved",
    );
  }
});
