import express from "express";
import { db } from "../lib/db.js";

const router = express.Router();

function buildApaReference({
  sourceAuthor,
  sourceYear,
  sourceTitle,
  sourcePublisher,
  sourceUrl,
  accessedDate,
  sourceType
}) {
  const author = String(sourceAuthor || "").trim() || "Unknown author";
  const year = String(sourceYear || "").trim() || "n.d.";
  const title = String(sourceTitle || "").trim() || "Untitled source";
  const publisher = String(sourcePublisher || "").trim();
  const url = String(sourceUrl || "").trim();

  const inTextCitation = `(${author}, ${year})`;

  let bibliographyEntry = `${author}. (${year}). ${title}.`;

  if (publisher) {
    bibliographyEntry += ` ${publisher}.`;
  }

  if (url) {
    bibliographyEntry += ` ${url}`;
  }

  if (sourceType === "website" && accessedDate) {
    bibliographyEntry += ` Accessed ${accessedDate}.`;
  }

  return {
    inTextCitation,
    bibliographyEntry
  };
}

router.post("/declarations", async (req, res) => {
  try {
    const user = req.signedCookies?.user;

    if (!user) {
      return res.status(401).send("Not logged in");
    }

    const {
      submissionId,
      sessionId = 0,
      pasteId,
      pastedText,
      declarationType,
      citationStyle,
      sourceType,
      sourceAuthor,
      sourceYear,
      sourceTitle,
      sourcePublisher,
      sourceUrl,
      accessedDate,
      studentExplanation
    } = req.body || {};

    if (!submissionId) {
      return res.status(400).send("Missing submissionId");
    }

    if (!declarationType) {
      return res.status(400).send("Missing declaration type");
    }

    if (!studentExplanation || !studentExplanation.trim()) {
      return res.status(400).send("Student explanation is required");
    }

    const safeSessionId = Number.isFinite(Number(sessionId))
      ? Number(sessionId)
      : 0;

    const citation = buildApaReference({
      sourceAuthor,
      sourceYear,
      sourceTitle,
      sourcePublisher,
      sourceUrl,
      accessedDate,
      sourceType
    });

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
          bibliography_entry,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
      args: [
        Number(submissionId),
        safeSessionId,
        declarationType,
        sourceType === "ai_tool" ? sourcePublisher || "AI tool" : "",
        "",
        pastedText || "",
        studentExplanation,
        citationStyle || "apa7",
        sourceType || "",
        sourceAuthor || "",
        sourceYear || "",
        sourceTitle || "",
        sourcePublisher || "",
        sourceUrl || "",
        accessedDate || "",
        citation.inTextCitation,
        citation.bibliographyEntry
      ]
    });

    res.json({
      success: true,
      ok: true,
      sessionId: safeSessionId,
      pasteId,
      inTextCitation: citation.inTextCitation,
      bibliographyEntry: citation.bibliographyEntry
    });
  } catch (err) {
    console.error("POST /api/declarations error:", err);
    res.status(500).send(`Failed to save declaration: ${err.message}`);
  }
});

router.post("/draft/autosave", async (req, res) => {
  try {
    const { submissionId, sessionId = 0, content = "", wordCount = 0 } = req.body || {};

    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    await db.execute({
      sql: `
        INSERT INTO draft_snapshots (
          submission_id,
          session_id,
          content,
          word_count,
          saved_at
        )
        VALUES (?, ?, ?, ?, datetime('now'))
      `,
      args: [
        Number(submissionId),
        Number.isFinite(Number(sessionId)) ? Number(sessionId) : 0,
        content,
        Number(wordCount || 0)
      ]
    });

    await db.execute({
      sql: `
        UPDATE submissions
        SET final_text = ?
        WHERE id = ?
      `,
      args: [content, Number(submissionId)]
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/draft/autosave error:", err);
    res.status(500).json({ error: err.message || "Autosave failed" });
  }
});

router.post("/event", async (req, res) => {
  try {
    const {
      submissionId,
      sessionId = 0,
      eventType,
      eventMeta = {}
    } = req.body || {};

    if (!submissionId || !eventType) {
      return res.status(400).json({ error: "submissionId and eventType are required" });
    }

    await db.execute({
      sql: `
        INSERT INTO editor_events (
          submission_id,
          session_id,
          event_type,
          event_meta,
          created_at
        )
        VALUES (?, ?, ?, ?, datetime('now'))
      `,
      args: [
        Number(submissionId),
        Number.isFinite(Number(sessionId)) ? Number(sessionId) : 0,
        eventType,
        JSON.stringify(eventMeta || {})
      ]
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/event error:", err);
    res.status(500).json({ error: err.message || "Event log failed" });
  }
});



router.post("/submit", async (req, res) => {
  try {
    const { submissionId, finalText = "" } = req.body || {};

    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    await db.execute({
      sql: `
        UPDATE submissions
        SET final_text = ?, status = 'submitted', submitted_at = datetime('now')
        WHERE id = ?
      `,
      args: [finalText, Number(submissionId)]
    });

    res.json({ ok: true, success: true });
  } catch (err) {
    console.error("POST /api/submit error:", err);
    res.status(500).json({ error: err.message || "Submit failed" });
  }
});

router.get("/classes/by-teacher", async (req, res) => {
  try {
    const user = req.signedCookies?.user;
    const teacherId = Number(req.query.teacherId || user?.id);

    if (!teacherId) return res.json([]);

    const result = await db.execute({
      sql: `
        SELECT *
        FROM classes
        WHERE teacher_id = ?
        ORDER BY id DESC
      `,
      args: [teacherId]
    });

    const classes = (result.rows || []).map((row) => ({
      id: row.id,
      name: row.class_name || row.name || row.title || `Class ${row.id}`,
      class_name: row.class_name || row.name || row.title || `Class ${row.id}`,
      year_level: row.year_level || "",
      subject: row.subject || ""
    }));

    res.json(classes);
  } catch (err) {
    console.error("GET /api/classes/by-teacher error:", err);
    res.status(500).json([]);
  }
});

router.get("/students/by-class", async (req, res) => {
  try {
    const classId = Number(req.query.classId);

    if (!classId) return res.json([]);

    const result = await db.execute({
      sql: `
        SELECT *
        FROM students
        WHERE class_id = ?
        ORDER BY name ASC
      `,
      args: [classId]
    });

    const students = (result.rows || []).map((row) => ({
      id: row.id,
      name: row.name || row.student_name || `Student ${row.id}`,
      email: row.email || "",
      student_pin: row.student_pin || row.pin || "",
      class_id: row.class_id
    }));

    res.json(students);
  } catch (err) {
    console.error("GET /api/students/by-class error:", err);
    res.status(500).json([]);
  }
});


export default router;