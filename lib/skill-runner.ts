// Deterministic skill checks used by /api/ship. These complement the natural
// interception the Claude Agent SDK performs from .claude/skills/ — they give
// the demo a reliable pattern match so the "skill fires" moment is crisp.

export type SkillViolation = {
  skill_id: string;
  title: string;
  message: string;
  fix_hint: string;
};

export type SkillCheckInput = {
  repo: string;
  file: string; // repo-relative
  content: string; // proposed full file content (post-edit)
  previous?: string | null;
  ticket?: string;
};

export function runSkillChecks(input: SkillCheckInput): SkillViolation[] {
  const violations: SkillViolation[] = [];
  violations.push(...checkSingleSourcePricing(input));
  violations.push(...checkNoRenewalImpact(input));
  violations.push(...checkBillingThroughService(input));
  return violations;
}

// single-source-pricing: pricing math must live in services/billing.ts.
// Any file OUTSIDE services/billing.ts that performs arithmetic on
// money-like identifiers is a violation.
function checkSingleSourcePricing(i: SkillCheckInput): SkillViolation[] {
  const inBillingService =
    i.repo === "flarebill-api" && /src\/services\/billing\.ts$/.test(i.file);
  if (inBillingService) return [];

  // Only code files can violate.
  if (!/\.(ts|tsx|js|jsx)$/.test(i.file)) return [];

  const arithmeticAgainstMoney = matchesAny(i.content, [
    // e.g. amount * 0.8, price - discount, total + fee
    /\b(amount|price|total|cents|subtotal|grandTotal|discount|fee|mrr|arr|chargeAmount|discountedPrice)\b\s*[=*+\-/]\s*[0-9.]/i,
    /\b[0-9.]+\s*[*/]\s*\b(amount|price|total|cents|subtotal|chargeAmount)\b/i,
    // common "compute a discount inline" pattern
    /\b(const|let)\s+(discounted|discount|final|net)[A-Z]\w*\s*=\s*[^;]*[*\-+][^;]*\b(amount|price|total|cents)\b/i,
  ]);

  if (arithmeticAgainstMoney) {
    return [
      {
        skill_id: "single-source-pricing",
        title: "single-source-pricing",
        message: `Inline pricing math detected in ${i.repo}:${i.file}. ADR-0001 says all monetary arithmetic must live in flarebill-api/src/services/billing.ts.`,
        fix_hint:
          "Remove the local arithmetic. Call into a function in flarebill-api/src/services/billing.ts (adding one if needed). The caller should consume a ready-made amount from the API quote response.",
      },
    ];
  }
  return [];
}

// no-renewal-impact: when the ticket mentions "first charge/payment" but the
// diff touches the recurring code path, that is a violation of ADR-0002.
function checkNoRenewalImpact(i: SkillCheckInput): SkillViolation[] {
  const isBillingService =
    i.repo === "flarebill-api" && /src\/services\/billing\.ts$/.test(i.file);
  if (!isBillingService) return [];

  const ticketMentionsFirst = /(first[- ]?(payment|charge)|initial\s+(charge|payment)|signup|referral)/i.test(
    i.ticket ?? "",
  );
  if (!ticketMentionsFirst) return [];

  // Check that the diff touches calculateRecurringCharge or helpers clearly
  // living on the recurring branch. We compare previous vs. proposed content.
  const recurringBlock = extractFunctionBlock(
    i.content,
    /function\s+calculateRecurringCharge\b/,
  );
  const prevRecurring = extractFunctionBlock(
    i.previous ?? "",
    /function\s+calculateRecurringCharge\b/,
  );
  if (recurringBlock && prevRecurring && recurringBlock !== prevRecurring) {
    return [
      {
        skill_id: "no-renewal-impact",
        title: "no-renewal-impact",
        message: `calculateRecurringCharge changed in ${i.repo}:${i.file}, but the ticket only asks for a first-charge change. ADR-0002 requires the two paths to be isolated.`,
        fix_hint:
          "Revert changes inside calculateRecurringCharge. Put the new logic in calculateFirstCharge (or a helper reachable only from it). Do not share helpers between the two paths.",
      },
    ];
  }

  // Heuristic: the diff introduces a shared helper called from both paths.
  if (
    /\brecurring\w*\b/i.test(i.content) &&
    /\bfirst\w*\b/i.test(i.content) &&
    /(calculateFirstCharge|calculateRecurringCharge)[^{]*\{[\s\S]*?\b(shared|common)\w*Discount\w*\b/i.test(
      i.content,
    )
  ) {
    return [
      {
        skill_id: "no-renewal-impact",
        title: "no-renewal-impact",
        message: `A shared discount helper appears in the recurring path after this edit. ADR-0002 forbids shared helpers between first-charge and recurring.`,
        fix_hint:
          "Inline the helper into calculateFirstCharge only, or give each path its own dedicated helper.",
      },
    ];
  }

  return [];
}

// billing-through-service: web never hardcodes prices or computes money.
function checkBillingThroughService(i: SkillCheckInput): SkillViolation[] {
  if (i.repo !== "flarebill-web") return [];
  if (!/\.(ts|tsx|js|jsx)$/.test(i.file)) return [];

  const hardcodedTierPrice = /\$[\s]?\d{2,4}(\.\d{2})?\b|\b(49|19|199|299|999)\.00\b/.test(
    i.content,
  );
  if (hardcodedTierPrice) {
    return [
      {
        skill_id: "billing-through-service",
        title: "billing-through-service",
        message: `Hardcoded tier price found in ${i.repo}:${i.file}. The web app never encodes money — it renders whatever flarebill-api returns from /quote.`,
        fix_hint:
          "Replace the literal with a value fetched from the API quote response. If the needed field is missing, add it to the quote response in flarebill-api — never duplicate the math.",
      },
    ];
  }
  return [];
}

function matchesAny(content: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(content));
}

// Extract the source of a top-level function (brace-balanced) starting at the
// line that matches `header`. Used to compare recurring-charge bodies across
// edits without a full parser.
function extractFunctionBlock(source: string, header: RegExp): string | null {
  const match = source.match(header);
  if (!match || match.index === undefined) return null;
  const start = source.indexOf("{", match.index);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  return null;
}
