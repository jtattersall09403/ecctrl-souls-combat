export const REVIEW_RUBRIC = Object.freeze([
  "Viewing order: I visually ingested recording.webm or its complete normal-speed-review.gif once at normal speed before pausing, scrubbing, reading metrics, or opening frame strips.",
  "Frame-level pass: only after the normal-speed pass, I inspected action-closeup.webm plus every image under motion-strips/ and transition-boundaries/ in order.",
  "Immediate read: a fresh viewer can identify the action and outcome without relying on telemetry or filenames.",
  "Actor roles: the actual player and enemy perform the intended attacker, defender, or victim motions.",
  "Timing and weight: anticipation, contact or impact, follow-through, and recovery form one coherent action.",
  "Transitions: entry and exit have no pose pop, frozen frame, early cut, or unintended state re-entry.",
  "Grounding and travel: feet or body respect the support plane, intended airtime, and controller-owned travel.",
  "Pose continuity: head, torso, limbs, weapon, and paired actors show no flicker, oscillation, or implausible jerk.",
  "Weapon and bodies: attachment and contact remain plausible without distracting self/body intersections.",
  "Camera and UI: the production view communicates the action without an overlay obscuring or misidentifying an actor.",
  "Holistic verdict: on first principles, this looks intentional, semantically right, and game-ready.",
]);

export const REQUIRED_VIEWING_ORDER = "NORMAL SPEED THEN FRAME LEVEL";
export const REQUIRED_REVIEWER_TYPE = "HUMAN PROJECT OWNER";

const TIMESTAMP = String.raw`\d{2}:\d{2}\.\d{3}`;
const VISIBLE_SUBJECT = /\b(?:silhouettes?|pose|posture|reaction|support|head|torso|pelvis|body|limb|arm|hand|leg|knee|foot|feet|blade|sword|weapon|floor|ground|plane|camera|reticle|contact|impact|stance)\b/i;
const VISIBLE_CLAIM = /\b(?:see|visible|visually|show(?:s|ed)?|look(?:s|ed)?|read(?:s)?|appear(?:s|ed)?|move(?:s|d|ment)?|motion|momentum|continuous|continuity|smooth|jerk|jitter|flicker|pop|sink|penetrat\w*|intersect\w*|grounded|weight|timing|crouch\w*|stand\w*|fall\w*|strike\w*|stagger\w*|roll\w*|dodge\w*|step\w*|jump\w*|land\w*|recoil\w*|guard\w*|parry\w*|stab\w*|swing\w*)\b/i;
const DIAGNOSTIC_LANGUAGE = /\b(?:telemetry|probe|metric|filename|manifest|json|threshold|expected state|expected animation|contract says|event log)\b/i;

function field(markdown, label) {
  const escapedLabel = label.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.match(new RegExp(`^${escapedLabel}: \\*\\*(.+?)\\*\\*\\s*$`, "m"))?.[1]?.trim();
}

function meaningful(value, minimumLength) {
  return Boolean(
    value
    && !/^(?:PENDING|UNKNOWN|N\/?A|TODO)$/i.test(value.trim())
    && value.trim().length >= minimumLength,
  );
}

function observation(section, label, minimumLength) {
  const match = section.match(new RegExp(`^${label} \\[(${TIMESTAMP})\\]: (.+)$`, "m"));
  if (!match || !meaningful(match[2], minimumLength)) return null;
  return { timestamp: match[1], text: match[2].trim() };
}

function visualGroundingIssue(value) {
  if (!VISIBLE_SUBJECT.test(value.text) || !VISIBLE_CLAIM.test(value.text)) {
    return "must describe concrete visible body, weapon, ground, contact, or camera evidence";
  }
  if (DIAGNOSTIC_LANGUAGE.test(value.text)
    && !/\b(?:see|visible|visually|show(?:s|ed)?|look(?:s|ed)?|read(?:s)?|appear(?:s|ed)?)\b/i.test(value.text)) {
    return "is telemetry/probe language without an explicit visual observation";
  }
  return null;
}

function timestampSeconds(timestamp) {
  const [minutes, seconds] = timestamp.split(":").map(Number);
  return minutes * 60 + seconds;
}

function artifactLine(section) {
  return section.match(/^Artifact: `([^`\n]+)`\s*$/m)?.[1] ?? null;
}

function evidenceItemBlocks(section) {
  return [...section.matchAll(
    /^### Evidence item `([^`\n]+)`\s*\n([\s\S]*?)(?=^### Evidence item `|^### |(?![\s\S]))/gm,
  )].map((match) => ({ id: match[1], body: match[2] }));
}

function displayTimestamp(seconds) {
  if (!Number.isFinite(seconds)) return "unknown";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
}

function evidenceItemTemplate(item) {
  return `### Evidence item \`${item.id}\`

Artifact: \`${item.artifact}\`

Scene window: **${displayTimestamp(item.start)}–${displayTimestamp(item.end)}**

Artifact observation [00:00.000]: PENDING

Artifact rationale [00:00.000]: PENDING

Evidence verdict: **PENDING**
`;
}

function expectedArtifactItems(evidence) {
  return [
    ...(Array.isArray(evidence?.strips) ? evidence.strips : []).map((strip) => ({
      id: strip.reviewId,
      kind: "animation-run",
      artifact: strip.path,
      start: strip.start,
      end: strip.end,
    })),
    ...(Array.isArray(evidence?.transitionBoundaryStrips) ? evidence.transitionBoundaryStrips : []).map((strip) => ({
      id: strip.reviewId,
      kind: "animation-transition",
      artifact: strip.path,
      start: strip.start,
      end: strip.end,
    })),
  ];
}

export function reviewSectionTemplate(scenario, label, evidence) {
  const itemTemplates = (evidence?.reviewChecklist ?? []).map(evidenceItemTemplate).join("\n");
  return `## ${scenario} — ${label}

Review dashboard: \`review.html#${scenario}\`

Full scene: \`${scenario}/recording.webm\`

Normal-speed GIF alternative: \`${scenario}/normal-speed-review.gif\`

Action close-up: \`${scenario}/action-closeup.webm\`

Frame strips: \`${scenario}/motion-strips/\` and \`${scenario}/transition-boundaries/\`

Viewing order: **PENDING**

First-watch observation [00:00.000]: PENDING

${itemTemplates}
Frame-level observation [00:00.000]: PENDING

First-principles rationale [00:00.000]: PENDING

${REVIEW_RUBRIC.map((item) => `- [ ] ${item}`).join("\n")}

Verdict: **PENDING**
`;
}

export function buildReviewMarkdown({
  generatedAt,
  runId,
  coverageSummary,
  scenarios,
  automatedStatus = "PASS",
  probeStatus = "PASS",
  crossScenarioStatus = "PASS",
}) {
  return `# Human animation review

Generated: ${generatedAt}  
Run: \`${runId}\`  
Reviewer: **PENDING**  
Reviewer type: **${REQUIRED_REVIEWER_TYPE}**  
Reviewed at: **PENDING**  
Automated production assertions: **${automatedStatus}**  
Render-pose probe assertions: **${probeStatus}**  
Cross-scenario assertions: **${crossScenarioStatus}**  
Semantic animation coverage: **${coverageSummary}**  
Qualitative status: **PENDING**

This file is for the project owner's visual judgment. Coding agents generate
and mechanically check the evidence, but must not watch it or fill these
verdicts unless the owner explicitly asks them to do so.

For every scenario, first watch \`recording.webm\` or its complete
\`normal-speed-review.gif\` once at normal speed without pausing and write the
immediate timestamped observation. Only then inspect the
action close-up, every dense rendered-run strip, and every ordered
transition-boundary strip. Fill every artifact id with a distinct timestamped
visual observation, first-principles rationale, and verdict, then complete the
scenario rubric. Generic or telemetry-only text is rejected. Use \`PASS\` only
when there is no animation defect. Automated probes can fail this run; they
can never make the qualitative decision for the reviewer.

${scenarios.map(({ scenario, label, evidence }) => reviewSectionTemplate(scenario, label, evidence)).join("\n")}`;
}

/** Pure validation used by the CLI checker and its regression tests. */
export function validateReview({ runId, run, markdown, expectedScenarios }) {
  const errors = [];
  if (run.automatedAssertions !== "pass") errors.push(`${runId}: automated assertions are not green`);
  if (run.probeAssertions !== "pass") errors.push(`${runId}: render-pose probe assertions are not green`);
  if (run.crossScenarioAssertions !== "pass") errors.push(`${runId}: cross-scenario assertions are not green`);
  if (run.recordVideo !== true) errors.push(`${runId}: a no-video smoke run cannot satisfy qualitative review`);
  if (run.evidenceVersion !== 6) errors.push(`${runId}: review evidence is missing or uses an obsolete format`);
  if (run.transitionObligationCoverage?.pass !== true
    || !Number.isInteger(run.transitionObligationCoverage?.obligations)
    || run.transitionObligationCoverage.obligations < 1) {
    errors.push(`${runId}: curated production transition obligations are missing or invalid`);
  }

  const missingScenarios = expectedScenarios.filter((scenario) => !run.scenarios?.includes(scenario));
  if (missingScenarios.length) errors.push(`${runId}: incomplete suite; missing ${missingScenarios.join(", ")}`);
  const reviewer = field(markdown, "Reviewer");
  if (!meaningful(reviewer, 3)) errors.push(`${runId}: Reviewer must name the human project owner`);
  const reviewerType = field(markdown, "Reviewer type");
  if (reviewerType !== REQUIRED_REVIEWER_TYPE) {
    errors.push(`${runId}: Reviewer type must be ${REQUIRED_REVIEWER_TYPE}`);
  }
  const reviewedAt = field(markdown, "Reviewed at");
  if (!reviewedAt
    || Number.isNaN(Date.parse(reviewedAt))
    || new Date(reviewedAt).toISOString() !== reviewedAt) {
    errors.push(`${runId}: Reviewed at must be the human reviewer's ISO completion timestamp`);
  }
  if (field(markdown, "Automated production assertions") !== "PASS") {
    errors.push(`${runId}: markdown automated production assertions must be PASS`);
  }
  if (field(markdown, "Render-pose probe assertions") !== "PASS") {
    errors.push(`${runId}: markdown render-pose probe assertions must be PASS`);
  }
  if (field(markdown, "Cross-scenario assertions") !== "PASS") {
    errors.push(`${runId}: markdown cross-scenario assertions must be PASS`);
  }
  const status = field(markdown, "Qualitative status");
  if (status !== "PASS") errors.push(`${runId}: holistic qualitative status must be unequivocal PASS`);

  const sections = markdown.split(/^## /m).slice(1);
  for (const scenario of expectedScenarios) {
    const section = sections.find((candidate) => candidate.startsWith(`${scenario} —`));
    if (!section) {
      errors.push(`${runId}: qualitative review is missing ${scenario}`);
      continue;
    }
    const evidence = run.scenarioEvidence?.[scenario];
    const strips = evidence?.strips;
    if (!Array.isArray(strips) || strips.length === 0) {
      errors.push(`${runId}: ${scenario} is missing required animation-run strips`);
    }
    const boundaryStrips = evidence?.transitionBoundaryStrips;
    if (!Array.isArray(boundaryStrips) || boundaryStrips.length === 0) {
      errors.push(`${runId}: ${scenario} is missing ordered semantic-transition boundary strips`);
    } else if (boundaryStrips.some((strip) => (
      !strip.path
      || (strip.fromAnimation === strip.toAnimation && !(
        Number.isFinite(strip.fromCommandSerial)
        && Number.isFinite(strip.toCommandSerial)
        && strip.fromCommandSerial !== strip.toCommandSerial
      ))
      || !(strip.start < strip.transitionTime && strip.transitionTime < strip.end)
    ))) {
      errors.push(`${runId}: ${scenario} has a transition strip that does not span its named boundary`);
    }

    const expectedItems = expectedArtifactItems(evidence);
    const checklist = evidence?.reviewChecklist;
    if (!Array.isArray(checklist)) {
      errors.push(`${runId}: ${scenario} is missing its artifact review checklist`);
    } else {
      const expectedKeys = expectedItems.map(({ id, kind, artifact }) => `${id}\u0000${kind}\u0000${artifact}`);
      const checklistKeys = checklist.map(({ id, kind, artifact }) => `${id}\u0000${kind}\u0000${artifact}`);
      const uniqueIds = new Set(checklist.map(({ id }) => id));
      const uniqueArtifacts = new Set(checklist.map(({ artifact }) => artifact));
      if (uniqueIds.size !== checklist.length) {
        errors.push(`${runId}: ${scenario} review checklist has duplicate ids`);
      }
      if (uniqueArtifacts.size !== checklist.length) {
        errors.push(`${runId}: ${scenario} review checklist has duplicate artifact paths`);
      }
      if (expectedKeys.length !== checklistKeys.length
        || expectedKeys.some((key, index) => key !== checklistKeys[index])) {
        errors.push(`${runId}: ${scenario} review checklist does not exactly match its ordered run/transition artifacts`);
      }
    }

    const reviewItems = evidenceItemBlocks(section);
    const expectedReviewItems = Array.isArray(checklist) ? checklist : [];
    if (reviewItems.length !== expectedReviewItems.length
      || reviewItems.some((item, index) => item.id !== expectedReviewItems[index]?.id)) {
      errors.push(`${runId}: ${scenario} artifact reviews do not exactly match the ordered checklist ids`);
    }
    const reviewedObservations = [];
    const reviewedRationales = [];
    for (let index = 0; index < Math.min(reviewItems.length, expectedReviewItems.length); index += 1) {
      const reviewItem = reviewItems[index];
      const checklistItem = expectedReviewItems[index];
      const evidenceWindow = expectedItems[index];
      if (artifactLine(reviewItem.body) !== checklistItem.artifact) {
        errors.push(`${runId}: ${scenario} ${checklistItem.id} names the wrong artifact`);
      }
      const itemObservation = observation(reviewItem.body, "Artifact observation", 20);
      if (!itemObservation) {
        errors.push(`${runId}: ${scenario} ${checklistItem.id} needs a timestamped artifact observation`);
      } else {
        reviewedObservations.push(itemObservation.text);
        const issue = visualGroundingIssue(itemObservation);
        if (issue) errors.push(`${runId}: ${scenario} ${checklistItem.id} artifact observation ${issue}`);
      }
      const itemRationale = observation(reviewItem.body, "Artifact rationale", 30);
      if (!itemRationale) {
        errors.push(`${runId}: ${scenario} ${checklistItem.id} needs a timestamped artifact rationale`);
      } else {
        reviewedRationales.push(itemRationale.text);
        const issue = visualGroundingIssue(itemRationale);
        if (issue) errors.push(`${runId}: ${scenario} ${checklistItem.id} artifact rationale ${issue}`);
      }
      for (const [name, value] of [["observation", itemObservation], ["rationale", itemRationale]]) {
        if (!value || !Number.isFinite(evidenceWindow?.start) || !Number.isFinite(evidenceWindow?.end)) continue;
        const at = timestampSeconds(value.timestamp);
        if (at < evidenceWindow.start - 0.001 || at > evidenceWindow.end + 0.001) {
          errors.push(`${runId}: ${scenario} ${checklistItem.id} ${name} timestamp is outside its evidence window`);
        }
      }
      if (field(reviewItem.body, "Evidence verdict") !== "PASS") {
        errors.push(`${runId}: ${scenario} ${checklistItem.id} evidence verdict must be unequivocal PASS`);
      }
    }
    if (new Set(reviewedObservations).size !== reviewedObservations.length) {
      errors.push(`${runId}: ${scenario} artifact observations contain copy-pasted duplicates`);
    }
    if (new Set(reviewedRationales).size !== reviewedRationales.length) {
      errors.push(`${runId}: ${scenario} artifact rationales contain copy-pasted duplicates`);
    }
    const viewingOrder = field(section, "Viewing order");
    if (viewingOrder !== REQUIRED_VIEWING_ORDER) {
      errors.push(`${runId}: ${scenario} must confirm ${REQUIRED_VIEWING_ORDER}`);
    }
    const firstWatch = observation(section, "First-watch observation", 20);
    if (!firstWatch) {
      errors.push(`${runId}: ${scenario} needs a timestamped normal-speed first-watch observation`);
    } else {
      const issue = visualGroundingIssue(firstWatch);
      if (issue) errors.push(`${runId}: ${scenario} first-watch observation ${issue}`);
    }
    const frameLevel = observation(section, "Frame-level observation", 20);
    if (!frameLevel) {
      errors.push(`${runId}: ${scenario} needs a timestamped frame-level observation`);
    } else {
      const issue = visualGroundingIssue(frameLevel);
      if (issue) errors.push(`${runId}: ${scenario} frame-level observation ${issue}`);
    }
    const firstPrinciples = observation(section, "First-principles rationale", 30);
    if (!firstPrinciples) {
      errors.push(`${runId}: ${scenario} needs a timestamped first-principles rationale`);
    } else {
      const issue = visualGroundingIssue(firstPrinciples);
      if (issue) errors.push(`${runId}: ${scenario} first-principles rationale ${issue}`);
    }

    const checks = [...section.matchAll(/^- \[([ xX])\] (.+)$/gm)];
    if (checks.length !== REVIEW_RUBRIC.length) {
      errors.push(`${runId}: ${scenario} rubric is incomplete (${checks.length}/${REVIEW_RUBRIC.length})`);
    } else if (checks.some((check) => check[1].toLowerCase() !== "x")) {
      errors.push(`${runId}: ${scenario} has unchecked qualitative rubric items`);
    }
    const actualRubric = checks.map((check) => check[2]);
    if (actualRubric.length === REVIEW_RUBRIC.length
      && actualRubric.some((item, index) => item !== REVIEW_RUBRIC[index])) {
      errors.push(`${runId}: ${scenario} rubric text/order does not match this evidence version`);
    }
    const verdict = field(section, "Verdict");
    if (verdict !== "PASS") errors.push(`${runId}: ${scenario} verdict must be unequivocal PASS`);
  }

  return {
    pass: errors.length === 0,
    reviewer: reviewer ?? null,
    reviewerType: reviewerType ?? null,
    reviewedAt: reviewedAt ?? null,
    errors,
  };
}
