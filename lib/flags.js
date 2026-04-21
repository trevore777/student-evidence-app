export function estimateSubmissionBreakdown({
  finalText = "",
  events = [],
  declarations = []
}) {
  const plainText = String(finalText || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const finalWordCount = plainText ? plainText.split(" ").length : 0;

  let pastedWords = 0;
  for (const event of events) {
    if (event.event_type !== "paste") continue;

    let meta = {};
    try {
      meta = typeof event.event_meta === "string"
        ? JSON.parse(event.event_meta)
        : (event.event_meta || {});
    } catch {
      meta = {};
    }

    const pastedLength = Number(meta.pastedLength || 0);
    const estimatedWords = pastedLength > 0 ? Math.max(1, Math.round(pastedLength / 5)) : 0;
    pastedWords += estimatedWords;
  }

  let aiWords = 0;
  for (const dec of declarations) {
    if (dec.declaration_type === "ai_generated" || dec.declaration_type === "ai_modified") {
      const excerpt = String(dec.original_text_excerpt || "");
      const words = excerpt.trim() ? excerpt.trim().split(/\s+/).length : 25;
      aiWords += words;
    }
  }

  pastedWords = Math.min(pastedWords, finalWordCount);
  aiWords = Math.min(aiWords, finalWordCount);

  const copyPasteWords = Math.min(pastedWords, Math.max(0, finalWordCount - aiWords));
  const ownWords = Math.max(0, finalWordCount - copyPasteWords - aiWords);

  const ownPercent = finalWordCount ? Math.round((ownWords / finalWordCount) * 100) : 0;
  const pastePercent = finalWordCount ? Math.round((copyPasteWords / finalWordCount) * 100) : 0;
  const aiPercent = finalWordCount ? Math.round((aiWords / finalWordCount) * 100) : 0;

  let confidence = "Low";
  if (events.length >= 3 || declarations.length >= 1) confidence = "Medium";
  if (events.length >= 5 && declarations.length >= 1) confidence = "High";

  return {
    finalWordCount,
    own_work_percent: ownPercent,
    paste_percent: pastePercent,
    ai_declared_percent: aiPercent,
    confidence
  };
}

export function buildSubmissionFlags({
  finalText = "",
  events = [],
  declarations = [],
  sessions = []
}) {
  const flags = [];
  const breakdown = estimateSubmissionBreakdown({ finalText, events, declarations });

  const totalActiveSeconds = sessions.reduce(
    (sum, s) => sum + Number(s.active_seconds || 0),
    0
  );

  const largePasteEvent = events.find((event) => {
    if (event.event_type !== "paste") return false;
    try {
      const meta = typeof event.event_meta === "string"
        ? JSON.parse(event.event_meta)
        : (event.event_meta || {});
      return Number(meta.pastedLength || 0) >= 500;
    } catch {
      return false;
    }
  });

  if (largePasteEvent) {
    flags.push({
      flag_code: "LARGE_PASTE",
      flag_message: "Large paste event detected.",
      severity: "warning"
    });
  }

  if (breakdown.paste_percent >= 40) {
    flags.push({
      flag_code: "HIGH_PASTE_SHARE",
      flag_message: "Estimated pasted content is a high share of the final submission.",
      severity: "warning"
    });
  }

  if (breakdown.ai_declared_percent >= 25) {
    flags.push({
      flag_code: "HIGH_AI_SHARE",
      flag_message: "Declared AI-assisted content is a high share of the final submission.",
      severity: "info"
    });
  }

  if (breakdown.finalWordCount >= 800 && totalActiveSeconds > 0 && totalActiveSeconds < 300) {
    flags.push({
      flag_code: "SHORT_ACTIVE_TIME",
      flag_message: "Long submission completed with very short active writing time.",
      severity: "warning"
    });
  }

  return {
    breakdown,
    flags
  };
}