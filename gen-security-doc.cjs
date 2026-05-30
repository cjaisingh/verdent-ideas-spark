const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require('docx');
const fs = require('fs');

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: "Arial", size: 22 },
      },
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "0F1B3D" },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "1E3A5F" },
        paragraph: { spacing: { before: 280, after: 100 }, outlineLevel: 1 },
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [
          new TextRun({ text: "AWIP Core", bold: true, size: 40, font: "Arial", color: "0F1B3D" }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new TextRun({ text: "Security Hardening Document", bold: true, size: 32, font: "Arial", color: "1E3A5F" }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 480 },
        children: [
          new TextRun({ text: "Accepted Risks & Mitigations", size: 24, font: "Arial", color: "3B6FA0", italics: true }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
        children: [
          new TextRun({ text: "30 May 2026", size: 20, font: "Arial", color: "718096" }),
        ],
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("1. pgvector Extension Internals")],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("The Supabase linter flags pgvector-created objects in the ")],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: "Risk", bold: true }), new TextRun(": pgvector installs index access methods, operator classes, and type casts into the ")],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: "Why this is accepted", bold: true }), new TextRun(": These objects are managed entirely by the pgvector extension. Moving or altering them would:")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("\u2022 Break existing vector indexes and similarity-search queries.")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("\u2022 Prevent future extension upgrades (Postgres refuses to upgrade modified extension objects).")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("\u2022 Require a forked extension, creating ongoing maintenance burden.")],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: "Mitigation", bold: true }), new TextRun(": pgvector is a widely-reviewed, open-source extension maintained by the Postgres community. The objects it creates are standard extension artefacts with no executable surface accessible to application users. The risk is therefore limited to the extension itself being compromised—an upstream supply-chain concern, not a configuration flaw we can remediate locally.")],
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("2. Operator / Admin SECURITY DEFINER Functions")],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("AWIP Core exposes a set of internal RPCs used by edge functions for system-level tasks. These are implemented as ")],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: "Risk", bold: true }), new TextRun(": SECURITY DEFINER functions execute with the privileges of their owner. If directly callable by untrusted roles, they could bypass RLS or perform privileged operations.")],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: "Protection model", bold: true }), new TextRun(":")],
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("2.1 Role-level revocation")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("\u2022 "), new TextRun({ text: "EXECUTE", bold: true }), new TextRun(" has been revoked from "), new TextRun({ text: "anon", bold: true }), new TextRun(" and "), new TextRun({ text: "authenticated", bold: true }), new TextRun(" on all 15 internal RPCs.")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("\u2022 Only "), new TextRun({ text: "service_role", bold: true }), new TextRun(" (used by edge functions) retains execution rights.")],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("\u2022 19 trigger functions (e.g. "), new TextRun({ text: "enforce_night_eligibility_by_risk", italics: true }), new TextRun(") also had EXECUTE revoked; they fire automatically on DML and are never invoked directly.")],
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("2.2 Edge-function auth gate")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("Every calling edge function performs its own authentication ")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("\u2022 "), new TextRun({ text: "Cron jobs", bold: true }), new TextRun(" must present the "), new TextRun({ text: "AWIP_SERVICE_TOKEN", italics: true }), new TextRun(" header.")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("\u2022 "), new TextRun({ text: "Manual invocations", bold: true }), new TextRun(" must present a valid Bearer JWT and pass "), new TextRun({ text: "has_role(auth.uid(), 'operator')", italics: true }), new TextRun(" or "), new TextRun({ text: "'admin'", italics: true }), new TextRun(" via the security-definer "), new TextRun({ text: "has_role()", italics: true }), new TextRun(" helper.")],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("Anonymous or authenticated non-operator requests are rejected with 401/403 before any RPC is reached.")],
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("2.3 has_role() as the trust anchor")],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("The "), new TextRun({ text: "has_role()", italics: true }), new TextRun(" function itself is SECURITY DEFINER so it can read "), new TextRun({ text: "user_roles", bold: true }), new TextRun(" regardless of the caller’s RLS context. It is the single, audited choke-point for all role checks. By design:")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("\u2022 It performs no writes.")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("\u2022 It accepts exactly two parameters: user_id and role enum.")],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("\u2022 It is short, stable, and referenced by every RLS policy and edge-function auth check.")],
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("3. Additional Hardening Measures")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("\u2022 All 11 public views were converted to "), new TextRun({ text: "security_invoker = on", italics: true }), new TextRun(" so they respect the querying user’s RLS policies.")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("\u2022 The "), new TextRun({ text: "normalise_alias()", italics: true }), new TextRun(" function has its search_path pinned to "), new TextRun({ text: "public, pg_temp", italics: true }), new TextRun(" to prevent search-path injection.")],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("\u2022 RLS is enabled on every user-facing table; policies combine "), new TextRun({ text: "auth.uid() = user_id", italics: true }), new TextRun(" with "), new TextRun({ text: "has_role(..., 'operator')", italics: true }), new TextRun(" or "), new TextRun({ text: "'admin'", italics: true }), new TextRun(" for operator-only surfaces.")],
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("4. Summary")],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("The remaining linter warnings fall into two categories:")],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun("1. "), new TextRun({ text: "Upstream extension artefacts", bold: true }), new TextRun(" (pgvector) that cannot be hardened without breaking compatibility and upgrade paths.")],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("2. "), new TextRun({ text: "Intentionally privileged RPCs", bold: true }), new TextRun(" whose SECURITY DEFINER is required for correct operation, and whose attack surface is closed by role-level revocation plus edge-function authentication.")],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("No further automated remediation is possible or desirable. Manual review of new RPCs and periodic re-audit of the "), new TextRun({ text: "has_role()", italics: true }), new TextRun(" trust anchor are the ongoing controls.")],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/mnt/documents/AWIP_Core_Security_Hardening.docx", buffer);
  console.log("Document written to /mnt/documents/AWIP_Core_Security_Hardening.docx");
});
