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

router.post("/ai-feedback", async (req, res) => {
  try {
    const {
      studentName = "",
      assignmentTitle = "",
      submissionText = "",
      rubricText = "",
      composition = {},
      flags = [],
      declarations = [],
      events = [],
      snapshots = []
    } = req.body || {};

    if (!rubricText || !rubricText.trim()) {
      return res.status(400).json({ error: "Rubric / ISMG text is required." });
    }

    if (!submissionText || !submissionText.trim()) {
      return res.status(400).json({ error: "Submission text is required." });
    }

function stripHtmlForAi(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function limitText(text = "", max = 6000) {
  const clean = String(text || "");
  return clean.length > max ? clean.slice(0, max) + "\n...[trimmed]" : clean;
}

const safeSubmissionText = limitText(stripHtmlForAi(submissionText), 7000);
const safeRubricText = limitText(stripHtmlForAi(rubricText), 5000);

const safeEvents = (events || []).slice(-20).map(e => ({
  event_type: e.event_type,
  created_at: e.created_at,
  event_meta: (() => {
    try {
      const meta = typeof e.event_meta === "string" ? JSON.parse(e.event_meta) : e.event_meta || {};
      return {
        pasteId: meta.pasteId,
        eventRef: meta.eventRef,
        pastedLength: meta.pastedLength,
        pastedPreview: limitText(meta.pastedPreview || "", 250)
      };
    } catch {
      return {};
    }
  })()
}));

const safeDeclarations = (declarations || []).slice(-10).map(d => ({
  declaration_type: d.declaration_type,
  student_explanation: limitText(d.student_explanation || "", 500),
  source_type: d.source_type,
  source_author: d.source_author,
  source_year: d.source_year,
  source_title: d.source_title,
  in_text_citation: d.in_text_citation,
  bibliography_entry: limitText(d.bibliography_entry || "", 500)
}));

const safeSnapshots = (snapshots || []).slice(-5).map(s => ({
  word_count: s.word_count,
  saved_at: s.saved_at
}));

    const prompt = `
You are assisting a school teacher to review student work.

Assess:
- submitted student work
- rubric / ISMG
- writing composition statistics
- paste evidence
- declarations and references
- editor events
- draft snapshot history

Do not make the final teacher decision. Return JSON only.

Rubric / ISMG:
${safeRubricText}

Student:
${studentName}

Assignment:
${assignmentTitle}

Student work:
${safeSubmissionText}

Composition:
${JSON.stringify(composition, null, 2)}

Flags:
${JSON.stringify(flags, null, 2)}

Declarations:
${JSON.stringify(safeDeclarations, null, 2)}

Editor events:
${JSON.stringify(safeEvents, null, 2)}

Draft snapshots:
${JSON.stringify(safeSnapshots, null, 2)}

Return this exact JSON structure:
{
  "totalMark": number,
  "totalPossible": 25,
  "suggestedGrade": string,
  "evidenceIntegrity": {
    "riskLevel": string,
    "summary": string,
    "recommendations": [string]
  },
  "criteria": [
    {
      "name": string,
      "mark": number,
      "possible": number,
      "evidence": string,
      "concern": string,
      "nextStep": string
    }
  ],
  "studentSummary": string,
  "teacherRecommendation": string,
  "teacherEmail": string
}
`;

    if (!process.env.OPENAI_API_KEY) {
      return res.json({
        totalMark: 0,
        totalPossible: 25,
        suggestedGrade: "Teacher review required",
        evidenceIntegrity: {
          riskLevel: "Review required",
          summary: "OpenAI API key is not configured. Manual review required.",
          recommendations: [
            "Check pasted and declared sections manually.",
            "Compare the response directly against the ISMG.",
            "Ask the student to explain key sections if authorship is unclear."
          ]
        },
        criteria: [
          {
            name: "Rubric / ISMG review",
            mark: 0,
            possible: 25,
            evidence: "AI assessment unavailable because API key is missing.",
            concern: "Teacher must complete judgement manually.",
            nextStep: "Configure OPENAI_API_KEY and retry."
          }
        ],
        studentSummary:
          "Your teacher will review your work against the rubric. Make sure your own explanations are clear and that copied, researched, or AI-supported material is declared and referenced.",
        teacherRecommendation:
          "Manual review required. AI endpoint is working, but OpenAI is not configured.",
        teacherEmail:
          `Hi ${studentName || "student"},\n\nYour work has been received. I will review it against the rubric and check the evidence record, including pasted material, declarations and references.\n\nRegards,\nTeacher`
      });
    }

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      input: prompt
    });

    const raw = response.output_text || "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : null;
    }

    if (!parsed) {
      return res.status(500).json({ error: "AI returned invalid JSON." });
    }

    res.json(parsed);
  } catch (err) {
    console.error("POST /api/ai-feedback error:", err);
    res.status(500).json({
      error: err.message || "AI feedback failed"
    });
  }
});

export default router;