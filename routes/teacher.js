import express from "express";
import { db } from "../lib/db.js";
import requireTeacher from "../middleware/requireTeacher.js";

const router = express.Router();

function normalizeRow(row, keys = []) {
  if (!row) return {};
  if (!Array.isArray(row)) return row;

  const obj = {};
  keys.forEach((key, i) => {
    obj[key] = row[i];
  });
  return obj;
}

function stripHtml(html = "") {
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function estimateComposition({ events = [], declarations = [], finalText = "" }) {
  const cleanText = stripHtml(finalText);
  const totalChars = cleanText.length || 1;

  const pasteEvents = events.filter((e) => e.event_type === "paste");
  let pastedChars = 0;

  pasteEvents.forEach((event) => {
    try {
      const meta = JSON.parse(event.event_meta || "{}");
      pastedChars += Number(meta.pastedLength || 0);
    } catch {
      pastedChars += 0;
    }
  });

  const aiDeclarations = declarations.filter((d) =>
    String(d.declaration_type || "").toLowerCase().includes("ai")
  );

  const pastePercent = Math.min(100, Math.round((pastedChars / totalChars) * 100));
  const aiDeclaredPercent = aiDeclarations.length ? Math.min(100, Math.round(aiDeclarations.length * 10)) : 0;
  const ownWorkPercent = Math.max(0, 100 - pastePercent - aiDeclaredPercent);

  return {
    own_work_percent: ownWorkPercent,
    paste_percent: pastePercent,
    ai_declared_percent: aiDeclaredPercent,
    confidence: events.length || declarations.length ? "Medium" : "Low"
  };
}

function computeFlags({ events = [], declarations = [] }) {
  const flags = [];

  const pasteEvents = events.filter((e) => e.event_type === "paste");

  if (pasteEvents.length >= 3) {
    flags.push({
      flag_code: "MULTIPLE_PASTE_EVENTS",
      flag_message: "Several paste events were recorded.",
      severity: "warning"
    });
  }

  let pastedChars = 0;

  pasteEvents.forEach((event) => {
    try {
      const meta = JSON.parse(event.event_meta || "{}");
      pastedChars += Number(meta.pastedLength || 0);
    } catch {
      pastedChars += 0;
    }
  });

  if (pastedChars > 1000) {
    flags.push({
      flag_code: "HIGH_PASTE_SHARE",
      flag_message: "A large amount of pasted content was recorded.",
      severity: "warning"
    });
  }

  const hasAiDeclaration = declarations.some((d) =>
    String(d.declaration_type || "").toLowerCase().includes("ai")
  );

  if (hasAiDeclaration) {
    flags.push({
      flag_code: "AI_DECLARED",
      flag_message: "Student declared AI use.",
      severity: "info"
    });
  }

  return flags;
}

/* =========================
   TEACHER DASHBOARD
========================= */

router.get("/dashboard", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const selectedClassId = req.query.classId ? Number(req.query.classId) : null;
    const show = req.query.show || "all";

    const classesResult = await db.execute({
      sql: `
        SELECT id, class_name, year_level, join_code
        FROM classes
        WHERE teacher_id = ?
        ORDER BY class_name ASC
      `,
      args: [teacher.id]
    });

    const classes = (classesResult.rows || []).map((row) =>
      normalizeRow(row, ["id", "class_name", "year_level", "join_code"])
    );

    const selectedClass =
      classes.find((c) => Number(c.id) === Number(selectedClassId)) ||
      classes[0] ||
      null;

    let assignments = [];
    let submissions = [];
    let exams = [];

    if (selectedClass) {
      const assignmentsResult = await db.execute({
        sql: `
          SELECT
            id,
            title,
            instructions,
            class_name,
            due_date,
            word_target,
            created_at
          FROM assignments
          WHERE teacher_id = ? AND class_id = ?
          ORDER BY created_at DESC
        `,
        args: [teacher.id, selectedClass.id]
      });

      assignments = (assignmentsResult.rows || []).map((row) =>
        normalizeRow(row, [
          "id",
          "title",
          "instructions",
          "class_name",
          "due_date",
          "word_target",
          "created_at"
        ])
      );

      let submissionWhere = `
        WHERE a.teacher_id = ?
          AND a.class_id = ?
      `;

      const submissionArgs = [teacher.id, selectedClass.id];

      if (show === "submitted") {
        submissionWhere += ` AND sub.status = 'submitted'`;
      }

      if (show === "draft") {
        submissionWhere += ` AND sub.status = 'draft'`;
      }

      const submissionsResult = await db.execute({
        sql: `
          SELECT
            sub.id,
            sub.status,
            sub.submitted_at,
            s.name AS student_name,
            s.email AS student_email,
            a.title AS assignment_title
          FROM submissions sub
          JOIN students s ON s.id = sub.student_id
          JOIN assignments a ON a.id = sub.assignment_id
          ${submissionWhere}
          ORDER BY sub.submitted_at DESC, s.name ASC
        `,
        args: submissionArgs
      });

      submissions = (submissionsResult.rows || []).map((row) =>
        normalizeRow(row, [
          "id",
          "status",
          "submitted_at",
          "student_name",
          "student_email",
          "assignment_title"
        ])
      );

      const examsResult = await db.execute({
        sql: `
          SELECT id, title, created_at
          FROM exams
          WHERE teacher_id = ? AND class_id = ?
          ORDER BY created_at DESC
        `,
        args: [teacher.id, selectedClass.id]
      });

      exams = (examsResult.rows || []).map((row) =>
        normalizeRow(row, ["id", "title", "created_at"])
      );
    }

    res.render("teacher-dashboard", {
      teacher,
      classes,
      selectedClass,
      assignments,
      submissions,
      exams,
      show,
      welcome: req.query.welcome === "1"
    });
  } catch (err) {
    console.error("GET /teacher/dashboard error:", err);
    res.status(500).send(`Failed to load teacher dashboard: ${err.message}`);
  }
});

/* =========================
   TEACHER SUBMISSION REVIEW
========================= */

router.get("/submission/:id", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const submissionId = Number(req.params.id);

    const submissionResult = await db.execute({
      sql: `
        SELECT
          sub.id,
          sub.assignment_id,
          sub.student_id,
          sub.final_text,
          sub.status,
          sub.submitted_at,
          s.name AS student_name,
          s.email AS student_email,
          c.class_name AS class_name,
          a.title AS assignment_title,
          a.instructions AS instructions,
          a.rubric_text AS rubric_text
        FROM submissions sub
        JOIN students s ON s.id = sub.student_id
        JOIN classes c ON c.id = s.class_id
        JOIN assignments a ON a.id = sub.assignment_id
        WHERE sub.id = ? AND a.teacher_id = ?
      `,
      args: [submissionId, teacher.id]
    });

    const submission = normalizeRow(submissionResult.rows?.[0], [
      "id",
      "assignment_id",
      "student_id",
      "final_text",
      "status",
      "submitted_at",
      "student_name",
      "student_email",
      "class_name",
      "assignment_title",
      "instructions",
      "rubric_text"
    ]);

    if (!submission.id) {
      return res.status(404).send("Submission not found");
    }

    const sessionsResult = await db.execute({
      sql: `
        SELECT started_at, ended_at, active_seconds, idle_seconds, device_info
        FROM writing_sessions
        WHERE submission_id = ?
        ORDER BY started_at ASC
      `,
      args: [submissionId]
    });

    const eventsResult = await db.execute({
      sql: `
        SELECT event_type, event_meta, created_at
        FROM editor_events
        WHERE submission_id = ?
        ORDER BY created_at ASC
      `,
      args: [submissionId]
    });

    const declarationsResult = await db.execute({
      sql: `
        SELECT
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
        FROM source_declarations
        WHERE submission_id = ?
        ORDER BY created_at ASC
      `,
      args: [submissionId]
    });

    const snapshotsResult = await db.execute({
      sql: `
        SELECT id, content, word_count, saved_at
        FROM draft_snapshots
        WHERE submission_id = ?
        ORDER BY saved_at ASC
      `,
      args: [submissionId]
    });

    const sessions = (sessionsResult.rows || []).map((row) =>
      normalizeRow(row, [
        "started_at",
        "ended_at",
        "active_seconds",
        "idle_seconds",
        "device_info"
      ])
    );

    const events = (eventsResult.rows || []).map((row) =>
      normalizeRow(row, ["event_type", "event_meta", "created_at"])
    );

    const declarations = (declarationsResult.rows || []).map((row) =>
      normalizeRow(row, [
        "declaration_type",
        "tool_name",
        "prompt_text",
        "original_text_excerpt",
        "student_explanation",
        "citation_style",
        "source_type",
        "source_author",
        "source_year",
        "source_title",
        "source_publisher",
        "source_url",
        "accessed_date",
        "in_text_citation",
        "bibliography_entry",
        "created_at"
      ])
    );

    const snapshots = (snapshotsResult.rows || []).map((row) =>
      normalizeRow(row, ["id", "content", "word_count", "saved_at"])
    );

    const composition = estimateComposition({
      events,
      declarations,
      sessions,
      finalText: submission.final_text || ""
    });

    const flags = computeFlags({
      events,
      declarations,
      sessions,
      finalText: submission.final_text || ""
    });

    res.render("teacher-review", {
      submission,
      sessions,
      events,
      declarations,
      snapshots,
      flags,
      composition
    });
  } catch (err) {
    console.error("GET /teacher/submission/:id error:", err);
    res.status(500).send(`Failed to load teacher review: ${err.message}`);
  }
});

export default router;