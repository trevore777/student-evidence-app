function stripHtml(html = "") {
  return String(html)
    .replace(/<[^>]*>/g, " ")
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
  const plainText = stripHtml(finalText);
  const finalWordCount = plainText ? plainText.split(/\s+/).length : 0;

  let pastedWords = 0;
  for (const event of events) {
    if (event.event_type !== "paste") continue;

    const meta = safeJsonParse(event.event_meta);
    const pastedLength = Number(meta.pastedLength || 0);
    pastedWords += estimateWordsFromChars(pastedLength);
  }

  let aiWords = 0;
  for (const dec of declarations) {
    if (dec.declaration_type === "ai_generated" || dec.declaration_type === "ai_modified") {
      const excerpt = stripHtml(dec.original_text_excerpt || "");
      aiWords += excerpt ? excerpt.split(/\s+/).length : 25;
    }
  }

  pastedWords = Math.min(pastedWords, finalWordCount);
  aiWords = Math.min(aiWords, finalWordCount);

  const copyPasteWords = Math.min(pastedWords, Math.max(0, finalWordCount - aiWords));
  const ownWords = Math.max(0, finalWordCount - copyPasteWords - aiWords);

  const own_work_percent = finalWordCount
    ? Math.round((ownWords / finalWordCount) * 100)
    : 0;

  const paste_percent = finalWordCount
    ? Math.round((copyPasteWords / finalWordCount) * 100)
    : 0;

  const ai_declared_percent = finalWordCount
    ? Math.round((aiWords / finalWordCount) * 100)
    : 0;

  let confidence = "Low";
  if (events.length >= 3 || declarations.length >= 1) confidence = "Medium";
  if (events.length >= 5 && declarations.length >= 1) confidence = "High";

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

  if (composition.paste_percent >= 40) {
    flags.push({
      flag_code: "HIGH_PASTE_SHARE",
      flag_message: "Estimated pasted content is a high share of the final submission.",
      severity: "warning"
    });
  }

  if (composition.ai_declared_percent >= 25) {
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