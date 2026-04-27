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
    const { submissionId, deviceInfo } = req.body;

    const result = await db.execute({
      sql: `
        INSERT INTO writing_sessions (submission_id, started_at, device_info)
        VALUES (?, CURRENT_TIMESTAMP, ?)
        RETURNING id
      `,
      args: [submissionId, deviceInfo || ""]
    });

    res.json({ ok: true, sessionId: result.rows[0]?.id ?? result.rows[0]?.[0] });
  } catch (err) {
    console.error("POST /api/session/start error:", err);
    res.status(500).json({ ok: false, error: "Failed to start session" });
  }
});

router.post("/session/end", async (req, res) => {
  try {
    const { sessionId, activeSeconds = 0, idleSeconds = 0 } = req.body;

    await db.execute({
      sql: `
        UPDATE writing_sessions
        SET ended_at = CURRENT_TIMESTAMP,
            active_seconds = ?,
            idle_seconds = ?
        WHERE id = ?
      `,
      args: [activeSeconds, idleSeconds, sessionId]
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/session/end error:", err);
    res.status(500).json({ ok: false, error: "Failed to end session" });
  }
});

router.post("/draft/autosave", async (req, res) => {
  try {
    const { submissionId, sessionId, content, wordCount } = req.body;

    await db.execute({
      sql: `
        INSERT INTO draft_snapshots (submission_id, session_id, content, word_count)
        VALUES (?, ?, ?, ?)
      `,
      args: [submissionId, sessionId, sanitizeRichText(content || ""), wordCount || 0]
    });

    await db.execute({
      sql: `UPDATE submissions SET final_text = ? WHERE id = ?`,
      args: [sanitizeRichText(content || ""), submissionId]
    });

    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error("POST /api/draft/autosave error:", err);
    res.status(500).json({ ok: false, error: "Failed to autosave draft" });
  }
});

router.post("/event", async (req, res) => {
  try {
    const { submissionId, sessionId, eventType, eventMeta } = req.body;

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
    } = req.body;

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
    const { submissionId, finalText } = req.body;

    await db.execute({
      sql: `
        UPDATE submissions
        SET final_text = ?, status = 'submitted', submitted_at = CURRENT_TIMESTAMP
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
    } = req.body;

    const prompt = `
You are helping a teacher write a constructive email to a student.

Write a professional, encouraging school-style feedback email.

Student name: ${studentName}
Student email: ${studentEmail}
Assignment title: ${assignmentTitle}

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
${finalText || ""}

Instructions:
- Write directly to the student.
- Use a supportive but honest tone.
- Include:
  1. greeting
  2. what was done well
  3. what needs improvement
  4. most important next step
  5. short encouragement at the end
- Keep it suitable for school use.
- Do not accuse the student of misconduct.
- Keep it concise and clear.
`;

    const response = await openai.responses.create({
      model: "gpt-5.4",
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
});

router.post("/ai/email", async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY is not configured"
      });
    }

    const yearLevelText = String(req.body.yearLevel || "").toLowerCase();
const isJunior = /year\s*7|year\s*8/.test(yearLevelText);
const isMiddle = /year\s*9|year\s*10/.test(yearLevelText);
const isSenior = /year\s*11|year\s*12/.test(yearLevelText);

const rubricType = cleanRubric.toLowerCase().includes("ismg")
  ? "ISMG"
  : cleanRubric
    ? "general rubric"
    : "no rubric";

const prompt = `
You are an Australian secondary teacher writing a short, student-friendly feedback email.

Student: ${studentName}
Year level: ${req.body.yearLevel || "Unknown"}
Assignment: ${assignmentTitle}
Rubric type: ${rubricType}

Rubric / ISMG:
${cleanRubric || "No rubric provided."}

Student submission:
${cleanSubmission.slice(0, 3500)}

Evidence profile:
- Own work estimate: ${composition?.own || 0}%
- Pasted content estimate: ${composition?.paste || 0}%
- AI declared estimate: ${composition?.ai || 0}%

Flags:
${(flags || []).join(", ") || "None"}

Teacher notes:
What went well: ${good || "-"}
Needs improvement: ${bad || "-"}
Most important next step: ${next || "-"}

Write ONE email to the student.

Adapt the feedback:
- If Year 7 or Year 8: use very simple language, no jargon, maximum 120 words.
- If Year 9 or Year 10: use clear practical feedback, maximum 170 words.
- If Year 11 or Year 12: use more specific rubric/ISMG language, maximum 230 words.
- If this is an ISMG, explicitly mention 1 or 2 relevant criteria/standards.
- If this is a general rubric, keep it simple and do not over-explain.
- If no rubric is provided, give short general feedback only.
- Do not overwhelm the student.
- Give no more than 2 improvement actions.
- If AI or pasted content appears, say they need to declare/revise it clearly, not accuse them.
- End with "Regards, Teacher".

Tone:
- encouraging
- specific
- concise
- age-appropriate
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

export default router;