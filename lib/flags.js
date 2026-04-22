function stripHtml(html = "") {
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJsonParse(value) {
  try {
    return typeof value === "string" ? JSON.parse(value) : (value || {});
  } catch {
    return {};
  }
}

function wordCount(text = "") {
  const clean = stripHtml(text);
  return clean ? clean.split(/\s+/).length : 0;
}

function estimateWordsFromChars(charCount = 0) {
  if (!charCount || charCount <= 0) return 0;
  return Math.max(1, Math.round(charCount / 5));
}

export function estimateComposition({
  finalText = "",
  events = [],
  declarations = [],
  sessions = []
}) {
  const finalWordCount = wordCount(finalText);

  let rawPastedWords = 0;
  for (const event of events) {
    if (event.event_type !== "paste") continue;
    const meta = safeJsonParse(event.event_meta);
    const pastedLength = Number(meta.pastedLength || 0);
    rawPastedWords += estimateWordsFromChars(pastedLength);
  }

  // Reduce the pasted impact because pasted text is often revised later.
  // This keeps the estimate more realistic for classroom writing.
  let adjustedPasteWords = Math.round(rawPastedWords * 0.55);

  let aiDeclaredWords = 0;
  for (const dec of declarations) {
    if (dec.declaration_type === "ai_generated" || dec.declaration_type === "ai_modified") {
      const excerptWords = wordCount(dec.original_text_excerpt || "");
      aiDeclaredWords += excerptWords > 0 ? excerptWords : 20;
    }
  }

  // Cap values so they stay realistic against the final submission size.
  adjustedPasteWords = Math.min(adjustedPasteWords, finalWordCount);
  aiDeclaredWords = Math.min(aiDeclaredWords, finalWordCount);

  // AI words should not double-count all pasted words.
  const aiPercentBase = finalWordCount ? Math.round((aiDeclaredWords / finalWordCount) * 100) : 0;
  const pastePercentBase = finalWordCount ? Math.round((adjustedPasteWords / finalWordCount) * 100) : 0;

  let ai_declared_percent = aiPercentBase;
  let paste_percent = pastePercentBase;

  // Avoid inflated totals.
  if (ai_declared_percent + paste_percent > 85) {
    const overflow = ai_declared_percent + paste_percent - 85;
    paste_percent = Math.max(0, paste_percent - overflow);
  }

  let own_work_percent = Math.max(0, 100 - paste_percent - ai_declared_percent);

  // Round drift correction
  const total = own_work_percent + paste_percent + ai_declared_percent;
  if (total !== 100) {
    own_work_percent += 100 - total;
  }

  let confidence = "Low";
  if (events.length >= 2 || declarations.length >= 1 || sessions.length >= 1) {
    confidence = "Medium";
  }
  if (events.length >= 4 && declarations.length >= 1 && sessions.length >= 1) {
    confidence = "High";
  }

  return {
    finalWordCount,
    own_work_percent,
    paste_percent,
    ai_declared_percent,
    confidence
  };
}

export function computeFlags({
  finalText = "",
  events = [],
  declarations = [],
  sessions = []
}) {
  const composition = estimateComposition({
    finalText,
    events,
    declarations,
    sessions
  });

  const flags = [];

  const totalActiveSeconds = sessions.reduce(
    (sum, s) => sum + Number(s.active_seconds || 0),
    0
  );

  const largePasteEvent = events.find((event) => {
    if (event.event_type !== "paste") return false;
    const meta = safeJsonParse(event.event_meta);
    return Number(meta.pastedLength || 0) >= 500;
  });

  if (largePasteEvent) {
    flags.push({
      flag_code: "LARGE_PASTE",
      flag_message: "Large paste event detected.",
      severity: "warning"
    });
  }

  if (composition.paste_percent >= 50) {
    flags.push({
      flag_code: "HIGH_PASTE_SHARE",
      flag_message: "Estimated pasted content is a high share of the final submission.",
      severity: "warning"
    });
  }

  if (composition.ai_declared_percent >= 30) {
    flags.push({
      flag_code: "HIGH_AI_SHARE",
      flag_message: "Declared AI-assisted content is a high share of the final submission.",
      severity: "info"
    });
  }

  if (
    composition.finalWordCount >= 800 &&
    totalActiveSeconds > 0 &&
    totalActiveSeconds < 300
  ) {
    flags.push({
      flag_code: "SHORT_ACTIVE_TIME",
      flag_message: "Long submission completed with very short active writing time.",
      severity: "warning"
    });
  }

  return flags;
}

export function buildSubmissionFlags(input) {
  return {
    flags: computeFlags(input),
    composition: estimateComposition(input)
  };
}