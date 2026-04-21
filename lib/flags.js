function safeParse(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function stripHtml(html = "") {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text = "") {
  const plain = stripHtml(text);
  return plain ? plain.split(/\s+/).length : 0;
}

function charsToWords(charCount = 0) {
  return Math.max(0, Math.round(Number(charCount || 0) / 6));
}

export function estimateComposition({ events = [], declarations = [], sessions = [], finalText = "" }) {
  const pasteEvents = events
    .filter((e) => e.event_type === "paste")
    .map((e) => ({ ...e, meta: safeParse(e.event_meta) }));

  const finalWords = countWords(finalText);
  const totalActive = sessions.reduce((sum, s) => sum + Number(s.active_seconds || 0), 0);

  const aiDeclarations = declarations.filter((d) => ["ai_generated", "ai_modified"].includes(d.declaration_type));
  const nonAiDeclarations = declarations.filter((d) => !["ai_generated", "ai_modified"].includes(d.declaration_type));

  const declaredAiWords = aiDeclarations.reduce((sum, d) => {
    const excerptWords = countWords(d.original_text_excerpt || "");
    return sum + excerptWords;
  }, 0);

  const declaredNonAiPasteWords = nonAiDeclarations.reduce((sum, d) => {
    const excerptWords = countWords(d.original_text_excerpt || "");
    return sum + excerptWords;
  }, 0);

  const estimatedPastedWords = pasteEvents.reduce((sum, e) => {
    const meta = e.meta || {};
    return sum + charsToWords(meta.pastedLength || 0);
  }, 0);

  let aiWords = Math.min(finalWords, declaredAiWords);
  let pasteWords = Math.min(finalWords, Math.max(estimatedPastedWords - aiWords, declaredNonAiPasteWords));
  let ownWords = Math.max(0, finalWords - aiWords - pasteWords);

  const overflow = ownWords + aiWords + pasteWords - finalWords;
  if (overflow > 0) {
    pasteWords = Math.max(0, pasteWords - overflow);
    ownWords = Math.max(0, finalWords - aiWords - pasteWords);
  }

  const confidenceScore = [
    pasteEvents.length > 0 ? 1 : 0,
    declarations.length > 0 ? 1 : 0,
    totalActive > 0 ? 1 : 0,
    finalWords > 0 ? 1 : 0,
    pasteEvents.length === declarations.length && pasteEvents.length > 0 ? 1 : 0
  ].reduce((a, b) => a + b, 0);

  let confidence = "Low";
  if (confidenceScore >= 4) confidence = "High";
  else if (confidenceScore >= 2) confidence = "Medium";

  const toPercent = (value) => (finalWords > 0 ? Math.round((value / finalWords) * 100) : 0);

  let ownPercent = toPercent(ownWords);
  let aiPercent = toPercent(aiWords);
  let pastePercent = toPercent(pasteWords);

  const totalPercent = ownPercent + aiPercent + pastePercent;
  if (finalWords > 0 && totalPercent !== 100) {
    ownPercent += 100 - totalPercent;
  }

  return {
    finalWords,
    ownWords,
    aiWords,
    pasteWords,
    ownPercent,
    aiPercent,
    pastePercent,
    confidence,
    notes: [
      "Percentages are estimates based on writing activity, paste events, and student declarations.",
      "AI percentage reflects declared AI-assisted or AI-generated content, not proof of authorship."
    ]
  };
}

export function computeFlags({ events = [], declarations = [], sessions = [], finalText = "" }) {
  const flags = [];

  const pasteEvents = events
    .filter((e) => e.event_type === "paste")
    .map((e) => ({ ...e, meta: safeParse(e.event_meta) }));

  const aiDecls = declarations.filter((d) => ["ai_generated", "ai_modified"].includes(d.declaration_type));
  const totalActive = sessions.reduce((sum, s) => sum + Number(s.active_seconds || 0), 0);
  const finalWords = countWords(finalText);

  for (const paste of pasteEvents) {
    const len = Number(paste.meta.pastedLength || 0);
    if (len >= 250) {
      flags.push({ code: "LARGE_PASTE", message: `Large paste detected (${len} characters).`, severity: "warning" });
    } else if (len >= 100) {
      flags.push({ code: "MEDIUM_PASTE", message: `Paste detected (${len} characters).`, severity: "info" });
    }
  }

  if (pasteEvents.length > declarations.length) {
    flags.push({ code: "PASTE_WITHOUT_MATCHING_DECLARATION", message: "There are more paste events than declarations.", severity: "warning" });
  }

  if (finalWords >= 800 && totalActive < 300) {
    flags.push({ code: "SHORT_ACTIVE_TIME", message: "Large final response with very short active writing time.", severity: "warning" });
  }

  for (const d of aiDecls) {
    if (!String(d.student_explanation || "").trim()) {
      flags.push({ code: "EMPTY_AI_EXPLANATION", message: "AI declaration has no explanation.", severity: "warning" });
    }
  }

  const composition = estimateComposition({ events, declarations, sessions, finalText });
  if (composition.pastePercent >= 40) {
    flags.push({ code: "HIGH_PASTE_SHARE", message: `Estimated pasted content is ${composition.pastePercent}% of the final submission.`, severity: "warning" });
  }
  if (composition.aiPercent >= 20) {
    flags.push({ code: "HIGH_DECLARED_AI_SHARE", message: `Declared AI-assisted content is estimated at ${composition.aiPercent}% of the final submission.`, severity: "info" });
  }

  return flags;
}
