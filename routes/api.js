import express from "express";
import { db } from "../lib/db.js";
import { openai } from "../lib/openai.js";
import { sanitizeRichText } from "../lib/sanitize.js";

const router = express.Router();

router.get("/classes/by-teacher", async (req, res) => {
  try {
    const { teacherId } = req.query;
    if (!teacherId) return res.json([]);

    const result = await db.execute({
      sql: `
        SELECT id, class_name
        FROM classes
        WHERE teacher_id = ?
        ORDER BY class_name ASC
      `,
      args: [teacherId]
    });

    const classes = (result.rows || []).map((row) => ({
      id: row.id ?? row[0],
      class_name: row.class_name ?? row[1]
    }));

    res.json(classes);
  } catch (err) {
    console.error("GET /api/classes/by-teacher error:", err);
    res.status(500).json([]);
  }
});

router.get("/students/by-class", async (req, res) => {
  try {
    const { classId } = req.query;
    if (!classId) return res.json([]);

    const result = await db.execute({
      sql: `
        SELECT id, name
        FROM students
        WHERE class_id = ?
        ORDER BY name ASC
      `,
      args: [classId]
    });

    const students = (result.rows || []).map((row) => ({
      id: row.id ?? row[0],
      name: row.name ?? row[1]
    }));

    res.json(students);
  } catch (err) {
    console.error("GET /api/students/by-class error:", err);
    res.status(500).json([]);
  }
});

router.post("/session/start", async (req, res) => {
  try {
    const { submissionId, deviceInfo } = req.body || {};

    if (!submissionId) {
      return res.status(400).json({
        ok: false,
        error: "submissionId is required"
      });
    }

    // INSERT
    await db.execute({
      sql: `
        INSERT INTO writing_sessions (submission_id, started_at, device_info)
        VALUES (?, CURRENT_TIMESTAMP, ?)
      `,
      args: [submissionId, deviceInfo || ""]
    });

    // GET LAST INSERT ID (SQLite-safe)
    const result = await db.execute({
      sql: `SELECT last_insert_rowid() as id`
    });

    const sessionId = result.rows?.[0]?.id;

    if (!sessionId) {
      return res.status(500).json({
        ok: false,
        error: "Session created but ID not returned"
      });
    }

    res.json({ ok: true, sessionId });

  } catch (err) {
    console.error("POST /api/session/start error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to start session"
    });
  }
});

router.post("/session/end", async (req, res) => {
  try {
    const { sessionId, activeSeconds = 0, idleSeconds = 0 } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({
        ok: false,
        error: "sessionId is required"
      });
    }

    await db.execute({
      sql: `
        UPDATE writing_sessions
        SET ended_at = CURRENT_TIMESTAMP,
            active_seconds = ?,
            idle_seconds = ?
        WHERE id = ?
      `,
      args: [
        Number(activeSeconds || 0),
        Number(idleSeconds || 0),
        sessionId
      ]
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/session/end error:", err);
    res.status(500).json({ ok: false, error: "Failed to end session" });
  }
});

router.post("/draft/autosave", async (req, res) => {
  try {
    const { submissionId, sessionId, content, wordCount } = req.body || {};

    if (!submissionId || !sessionId) {
      return res.status(400).json({
        ok: false,
        error: "submissionId and sessionId are required"
      });
    }

    const cleanedContent = sanitizeRichText(content || "");

    await db.execute({
      sql: `
        INSERT INTO draft_snapshots (submission_id, session_id, content, word_count)
        VALUES (?, ?, ?, ?)
      `,
      args: [
        submissionId,
        sessionId,
        cleanedContent,
        Number(wordCount || 0)
      ]
    });

    await db.execute({
      sql: `
        UPDATE submissions
        SET final_text = ?
        WHERE id = ?
      `,
      args: [cleanedContent, submissionId]
    });

    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error("POST /api/draft/autosave error:", err);
    res.status(500).json({ ok: false, error: "Failed to autosave draft" });
  }
});

router.post("/event", async (req, res) => {
  try {
    const { submissionId, sessionId, eventType, eventMeta } = req.body || {};

    if (!submissionId || !sessionId) {
      return res.status(400).json({
        ok: false,
        error: "submissionId and sessionId are required"
      });
    }

    await db.execute({
      sql: `
        INSERT INTO editor_events (submission_id, session_id, event_type, event_meta)
        VALUES (?, ?, ?, ?)
      `,
      args: [
        submissionId,
        sessionId,
        eventType || "unknown",
        JSON.stringify(eventMeta || {})
      ]
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/event error:", err);
    res.status(500).json({ ok: false, error: "Failed to record event" });
  }
});

router.post("/declaration", async (req, res) => {
  try {
    const {
      submissionId,
      sessionId,
      declarationType,
      toolName,
      promptText,
      originalTextExcerpt,
      studentExplanation,
      citationStyle,
      sourceType,
      sourceAuthor,
      sourceYear,
      sourceTitle,
      sourcePublisher,
      sourceUrl,
      accessedDate,
      inTextCitation,
      bibliographyEntry
    } = req.body || {};

    if (!submissionId || !sessionId || !declarationType) {
      return res.status(400).json({
        ok: false,
        error: "submissionId, sessionId, and declarationType are required"
      });
    }

    await db.execute({
      sql: `
        INSERT INTO source_declarations (
          submission_id,
          session_id,
          declaration_type,
          tool_name,
          prompt_text,
          original_text_excerpt,
          student_explanation,
          citation_style,
          source_type,
          source_author,
          source_year,
          source_title,
          source_publisher,
          source_url,
          accessed_date,
          in_text_citation,
          bibliography_entry
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        submissionId,
        sessionId,
        declarationType,
        toolName || "",
        promptText || "",
        originalTextExcerpt || "",
        studentExplanation || "",
        citationStyle || "",
        sourceType || "",
        sourceAuthor || "",
        sourceYear || "",
        sourceTitle || "",
        sourcePublisher || "",
        sourceUrl || "",
        accessedDate || "",
        inTextCitation || "",
        bibliographyEntry || ""
      ]
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/declaration error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to save declaration"
    });
  }
});

router.post("/submit", async (req, res) => {
  try {
    const { submissionId, finalText } = req.body || {};

    if (!submissionId) {
      return res.status(400).json({
        ok: false,
        error: "submissionId is required"
      });
    }

    await db.execute({
      sql: `
        UPDATE submissions
        SET final_text = ?,
            status = 'submitted',
            submitted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [sanitizeRichText(finalText || ""), submissionId]
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/submit error:", err);
    res.status(500).json({ ok: false, error: "Failed to submit work" });
  }
});

/**
 * Current AI feedback route used by teacher-review.ejs
 */
router.post("/ai/email", async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY is not configured"
      });
    }

    const body = req.body || {};

    const studentName = body.studentName || "Student";
    const assignmentTitle = body.assignmentTitle || "the assignment";
    const submissionText = body.submissionText || "";
    const rubricText = body.rubricText || "";
    const yearLevel = body.yearLevel || "Unknown";

    const composition = body.composition || {};
    const flags = Array.isArray(body.flags) ? body.flags : [];
    const declarations = Array.isArray(body.declarations) ? body.declarations : [];

    const good = body.good || "";
    const bad = body.bad || "";
    const next = body.next || "";

    const cleanSubmission = String(submissionText)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3500);

    const cleanRubric = String(rubricText)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2500);

    const yearLevelText = String(yearLevel || "").toLowerCase();

    const isJunior = /year\s*7|year\s*8|\b7\b|\b8\b/.test(yearLevelText);
    const isMiddle = /year\s*9|year\s*10|\b9\b|\b10\b/.test(yearLevelText);
    const isSenior = /year\s*11|year\s*12|\b11\b|\b12\b/.test(yearLevelText);

    const rubricType = cleanRubric.toLowerCase().includes("ismg")
      ? "ISMG"
      : cleanRubric
        ? "general rubric"
        : "no rubric";

    let lengthInstruction = "maximum 170 words";
    let levelInstruction = "Use clear, practical feedback.";

    if (isJunior) {
      lengthInstruction = "maximum 120 words";
      levelInstruction = "Use very simple language, no jargon, and no more than two improvement actions.";
    } else if (isMiddle) {
      lengthInstruction = "maximum 170 words";
      levelInstruction = "Use clear practical feedback with simple task-specific advice.";
    } else if (isSenior) {
      lengthInstruction = "maximum 230 words";
      levelInstruction = "Use more specific rubric or ISMG language, but keep it readable and concise.";
    }

    const prompt = `
You are an Australian secondary teacher writing a short, student-friendly feedback email.

Student: ${studentName}
Year level / class: ${yearLevel}
Assignment: ${assignmentTitle}
Rubric type: ${rubricType}

Rubric / ISMG:
${cleanRubric || "No rubric provided."}

Student submission:
${cleanSubmission || "No submitted text provided."}

Evidence profile:
- Own work estimate: ${composition.own || 0}%
- Pasted content estimate: ${composition.paste || 0}%
- AI declared estimate: ${composition.ai || 0}%

Flags:
${flags.join(", ") || "None"}

Source declarations:
${JSON.stringify(declarations || [], null, 2)}

Teacher notes:
What went well: ${good || "-"}
Needs improvement: ${bad || "-"}
Most important next step: ${next || "-"}

Write ONE email to the student.

Rules:
- ${levelInstruction}
- Keep the whole email to ${lengthInstruction}.
- If this is an ISMG, explicitly mention 1 or 2 relevant criteria/standards.
- If this is a general rubric, keep it simple and do not over-explain.
- If no rubric is provided, give short general feedback only.
- Do not overwhelm the student.
- Give no more than 2 improvement actions.
- If AI or pasted content appears, say they need to declare, revise, or integrate it clearly. Do not accuse them.
- Be encouraging, specific, concise, and age-appropriate.
- End with "Regards, Teacher".
`;

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      input: prompt
    });

    res.json({
      ok: true,
      email: response.output_text || "Unable to generate email."
    });
  } catch (err) {
    console.error("POST /api/ai/email error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to generate AI email"
    });
  }
});

/**
 * Legacy route kept so older front-end code does not break.
 */
router.post("/ai/generate-feedback-email", async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY is not configured"
      });
    }

    const {
      studentName,
      studentEmail,
      assignmentTitle,
      finalText,
      flags,
      declarations,
      composition,
      goodNotes,
      badNotes,
      uglyNotes
    } = req.body || {};

    const cleanFinalText = String(finalText || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3500);

    const prompt = `
You are helping a teacher write a constructive email to a student.

Student name: ${studentName || "Student"}
Student email: ${studentEmail || ""}
Assignment title: ${assignmentTitle || "Assignment"}

Estimated submission composition:
${JSON.stringify(composition || {}, null, 2)}

Teacher notes:
What the student did well:
${goodNotes || "-"}

What needs improvement:
${badNotes || "-"}

Most important next step:
${uglyNotes || "-"}

Submission flags:
${JSON.stringify(flags || [], null, 2)}

Source declarations:
${JSON.stringify(declarations || [], null, 2)}

Student final submission:
${cleanFinalText || "No submitted text provided."}

Write a short, supportive, school-appropriate feedback email.
Refer to the student's actual submitted work where possible.
Do not accuse the student of misconduct.
End with "Regards, Teacher".
`;

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      input: prompt
    });

    const draft = response.output_text || "Unable to generate draft at this time.";

    res.json({ ok: true, draft });
  } catch (err) {
    console.error("POST /api/ai/generate-feedback-email error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to generate AI feedback email"
    });
  }

router.post("/ai/mark-question", async (req, res) => {
  try {
    if (!openai) {
      return res.json({ ok: false, error: "AI not configured" });
    }

    const {
      question,
      answerGuide,
      studentAnswer,
      maxMarks
    } = req.body;

    const prompt = `
You are marking a student exam answer.

Question:
${question}

Marking guide:
${answerGuide}

Student answer:
${studentAnswer}

Max marks: ${maxMarks}

Return JSON:
{
  "mark": number,
  "feedback": "short explanation"
}
`;

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      input: prompt
    });

    res.json({
      ok: true,
      result: response.output_text
    });

  } catch (err) {
    console.error("AI marking error:", err);
    res.json({ ok: false });
  }
});

});

router.post("/ai/grammar-check", async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY is not configured"
      });
    }

    const { text, yearLevel } = req.body || {};

    const cleanText = String(text || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2500);

    if (!cleanText) {
      return res.status(400).json({
        ok: false,
        error: "No text provided"
      });
    }

    const prompt = `
You are helping a student improve spelling, grammar, punctuation, and clarity.

Year level: ${yearLevel || "Unknown"}

Student text:
${cleanText}

Return JSON only:
{
  "corrected_text": "corrected version here",
  "changes_summary": "short explanation of the main spelling/grammar changes"
}

Rules:
- Do not add new ideas.
- Do not improve the argument beyond grammar and clarity.
- Keep the student's voice.
- For Year 7-8, keep language simple.
- For Year 10-12, keep academic tone but do not rewrite content heavily.
`;

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      input: prompt
    });

    let parsed;

    try {
      parsed = JSON.parse(response.output_text.replace(/```json|```/g, "").trim());
    } catch {
      parsed = {
        corrected_text: response.output_text || "",
        changes_summary: "Grammar and spelling suggestions generated."
      };
    }

    res.json({
      ok: true,
      correctedText: parsed.corrected_text || "",
      changesSummary: parsed.changes_summary || ""
    });
  } catch (err) {
    console.error("POST /api/ai/grammar-check error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to check grammar"
    });
  }
});


export default router;