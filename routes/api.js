import express from "express";
import { db } from "../lib/db.js";
import { openai } from "../lib/openai.js";

const router = express.Router();

// Temporary hardcoded students so class dropdown works even if DB is failing
const studentsByClass = {
  "Year 10A": [
    { id: 1, name: "Demo Student" },
    { id: 2, name: "Ella Brown" }
  ],
  "Year 10B": [
    { id: 3, name: "Noah Smith" },
    { id: 4, name: "Ruby Jones" }
  ]
};

router.get("/students/by-class", async (req, res) => {
  try {
    const { className } = req.query;
    return res.json(studentsByClass[className] || []);
  } catch (err) {
    console.error("GET /api/students/by-class error:", err);
    return res.json([]);
  }
});

// ======================
// SESSION START
// ======================
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

    res.json({ ok: true, sessionId: result.rows[0].id });
  } catch (err) {
    console.error("POST /api/session/start error:", err);
    res.status(500).json({ ok: false, error: "Failed to start session" });
  }
});

// ======================
// SESSION END
// ======================
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

// ======================
// AUTOSAVE
// ======================
router.post("/draft/autosave", async (req, res) => {
  try {
    const { submissionId, sessionId, content, wordCount } = req.body;

    await db.execute({
      sql: `
        INSERT INTO draft_snapshots (submission_id, session_id, content, word_count)
        VALUES (?, ?, ?, ?)
      `,
      args: [submissionId, sessionId, content || "", wordCount || 0]
    });

    await db.execute({
      sql: `UPDATE submissions SET final_text = ? WHERE id = ?`,
      args: [content || "", submissionId]
    });

    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error("POST /api/draft/autosave error:", err);
    res.status(500).json({ ok: false, error: "Failed to autosave draft" });
  }
});

// ======================
// EDITOR EVENT
// ======================
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

// ======================
// SOURCE DECLARATION
// ======================
router.post("/declaration", async (req, res) => {
  try {
    const {
      submissionId,
      sessionId,
      declarationType,
      toolName,
      promptText,
      originalTextExcerpt,
      studentExplanation
    } = req.body;

    await db.execute({
      sql: `
        INSERT INTO source_declarations (
          submission_id,
          session_id,
          declaration_type,
          tool_name,
          prompt_text,
          original_text_excerpt,
          student_explanation
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        submissionId,
        sessionId,
        declarationType || "other",
        toolName || "",
        promptText || "",
        originalTextExcerpt || "",
        studentExplanation || ""
      ]
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/declaration error:", err);
    res.status(500).json({ ok: false, error: "Failed to save declaration" });
  }
});

// ======================
// SUBMIT
// ======================
router.post("/submit", async (req, res) => {
  try {
    const { submissionId, finalText } = req.body;

    await db.execute({
      sql: `
        UPDATE submissions
        SET final_text = ?, status = 'submitted', submitted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [finalText || "", submissionId]
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/submit error:", err);
    res.status(500).json({ ok: false, error: "Failed to submit work" });
  }
});

// ======================
// AI FEEDBACK EMAIL DRAFT
// ======================
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

export default router;