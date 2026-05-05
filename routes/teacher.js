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


function countWords(text = "") {
  const clean = String(text || "").trim();
  return clean ? clean.split(/\s+/).filter(Boolean).length : 0;
}

function getTextFromHtml(html = "") {
  return stripHtml(html);
}

function estimateCompositionFromHtml(html = "") {
  const totalWords = countWords(getTextFromHtml(html));

  if (!totalWords) {
    return {
      own_work_percent: 0,
      paste_percent: 0,
      ai_declared_percent: 0,
      confidence: "Low"
    };
  }

  const pastedMatches = String(html).match(
    /<[^>]+(?:class="[^"]*pasted-content[^"]*"|data-pasted="true")[^>]*>[\s\S]*?<\/[^>]+>/gi
  ) || [];

  const declaredMatches = String(html).match(
    /<[^>]+(?:class="[^"]*declared-content[^"]*"|data-declared="true")[^>]*>[\s\S]*?<\/[^>]+>/gi
  ) || [];

  const aiMatches = String(html).match(
    /<[^>]+class="[^"]*(?:ai-generated-content|ai-modified-content)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi
  ) || [];

  const pastedWords = pastedMatches.reduce((sum, chunk) => sum + countWords(getTextFromHtml(chunk)), 0);
  const declaredWords = declaredMatches.reduce((sum, chunk) => sum + countWords(getTextFromHtml(chunk)), 0);
  const aiWords = aiMatches.reduce((sum, chunk) => sum + countWords(getTextFromHtml(chunk)), 0);

  const pastePercent = Math.min(100, Math.round((pastedWords / totalWords) * 100));
  const aiDeclaredPercent = Math.min(100, Math.round(((declaredWords + aiWords) / totalWords) * 100));
  const ownWorkPercent = Math.max(0, 100 - pastePercent);

  return {
    own_work_percent: ownWorkPercent,
    paste_percent: pastePercent,
    ai_declared_percent: aiDeclaredPercent,
    confidence: pastedWords || declaredWords || aiWords ? "High" : "Low"
  };
}

/* ADD IT HERE */
function applyEvidenceHighlights(html, events = [], declarations = []) {
  let output = html || "";

  const pasteEvents = events.filter((e) =>
    ["paste", "external_paste"].includes(e.event_type)
  );

  if (!pasteEvents.length) return output;

  if (output.includes("data-pasted") || output.includes("pasted-content")) {
    return output;
  }

  return `
    <div class="evidence-paste pasted-content">
      ${output}
    </div>
  `;
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
  const aiDeclaredPercent = aiDeclarations.length
    ? Math.min(100, Math.round(aiDeclarations.length * 10))
    : 0;
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
    const user = req.signedCookies?.user;
    const teacher = req.signedCookies?.user;
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

    let selectedClassId = req.query.classId ? Number(req.query.classId) : null;

    if (!Number.isFinite(selectedClassId)) {
      selectedClassId = null;
    }

    const selectedClass =
      classes.find((c) => Number(c.id) === Number(selectedClassId)) ||
      classes[0] ||
      null;

    selectedClassId = selectedClass ? Number(selectedClass.id) : null;

    if (!selectedClassId) {
      return res.render("teacher-dashboard", {
        user,
        teacher,
        classes,
        selectedClassId: null,
        selectedClass: null,
        assignments: [],
        students: [],
        submissions: [],
        show
      });
    }

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
        WHERE class_id = ?
        ORDER BY created_at DESC
      `,
      args: [selectedClassId]
    });

    const assignments = (assignmentsResult.rows || []).map((row) =>
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

    const studentsResult = await db.execute({
      sql: `
        SELECT id, name, email, class_id
        FROM students
        WHERE class_id = ?
        ORDER BY name ASC
      `,
      args: [selectedClassId]
    });

    const students = (studentsResult.rows || []).map((row) =>
      normalizeRow(row, ["id", "name", "email", "class_id"])
    );

    let submissionWhere = `
      WHERE a.teacher_id = ?
        AND a.class_id = ?
    `;

    const submissionArgs = [teacher.id, selectedClassId];

    if (show === "submitted") {
      submissionWhere += ` AND sub.status = 'submitted'`;
    }

    if (show === "draft") {
      submissionWhere += ` AND sub.status = 'draft'`;
    }

    if (show === "flagged") {
      submissionWhere += `
        AND (
          EXISTS (
            SELECT 1
            FROM editor_events ev
            WHERE ev.submission_id = sub.id
              AND ev.event_type IN ('paste', 'external_paste', 'internal_paste', 'internal_move_paste')
          )
          OR EXISTS (
            SELECT 1
            FROM source_declarations sd
            WHERE sd.submission_id = sub.id
          )
        )
      `;
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

const submissions = (submissionsResult.rows || []).map((row) =>
  normalizeRow(row, [
    "id",
    "status",
    "submitted_at",
    "student_name",
    "student_email",
    "assignment_title"
  ])
);

    res.render("teacher-dashboard", {
      user,
      teacher,
      classes,
      selectedClassId,
      selectedClass,
      assignments,
      students,
      submissions,
      show
    });
  } catch (err) {
    console.error("GET /teacher/dashboard error:", err);
    res.status(500).send(`Failed to load teacher dashboard: ${err.message}`);
  }
});

/* =========================
   CLASS INSIGHTS
========================= */

router.get("/class/:classId/insights", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies?.user;
    const classId = Number(req.params.classId);

    if (!Number.isFinite(classId)) {
      return res.status(400).send("Invalid class ID");
    }

    const classCheck = await db.execute({
      sql: `
        SELECT id, class_name
        FROM classes
        WHERE id = ? AND teacher_id = ?
      `,
      args: [classId, teacher.id]
    });

    const classRow = normalizeRow(classCheck.rows?.[0], ["id", "class_name"]);

    if (!classRow.id) {
      return res.status(404).send("Class not found");
    }

    const studentsRes = await db.execute({
      sql: `
        SELECT id, name
        FROM students
        WHERE class_id = ?
        ORDER BY name ASC
      `,
      args: [classId]
    });

    const students = (studentsRes.rows || []).map((row) =>
      normalizeRow(row, ["id", "name"])
    );

    const insights = [];

    for (const student of students) {
      const submissionRes = await db.execute({
        sql: `
          SELECT
            sub.id,
            sub.final_text,
            sub.status,
            sub.submitted_at,
            a.title AS assignment_title
          FROM submissions sub
          JOIN assignments a ON a.id = sub.assignment_id
          WHERE sub.student_id = ?
          ORDER BY sub.id DESC
          LIMIT 1
        `,
        args: [student.id]
      });

      const submission = normalizeRow(submissionRes.rows?.[0], [
        "id",
        "final_text",
        "status",
        "submitted_at",
        "assignment_title"
      ]);

      const eventsRes = await db.execute({
        sql: `
          SELECT event_type, event_meta, created_at
          FROM editor_events
          WHERE submission_id = ?
          ORDER BY created_at DESC
        `,
        args: [submission.id || 0]
      });

      const events = (eventsRes.rows || []).map((row) =>
        normalizeRow(row, ["event_type", "event_meta", "created_at"])
      );

      const declarationsRes = await db.execute({
        sql: `
          SELECT id
          FROM source_declarations
          WHERE submission_id = ?
        `,
        args: [submission.id || 0]
      });

      const cleanText = stripHtml(submission.final_text || "");
      const wordCount = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;

      const pasteEvents = events.filter((e) =>
        ["paste", "external_paste", "internal_paste", "internal_move_paste"].includes(e.event_type)
      ).length;

      const externalPasteEvents = events.filter((e) =>
        ["paste", "external_paste"].includes(e.event_type)
      ).length;

      const declarationsCount = declarationsRes.rows?.length || 0;

      let status = "on_track";
      let statusLabel = "On track";

      if (!submission.id) {
        status = "no_work";
        statusLabel = "No work started";
      } else if (wordCount < 50 && submission.status !== "submitted") {
        status = "needs_help";
        statusLabel = "Needs help";
      } else if (externalPasteEvents > 0 && declarationsCount === 0) {
        status = "at_risk";
        statusLabel = "Check declaration";
      } else if (pasteEvents >= 3) {
        status = "at_risk";
        statusLabel = "Check progress";
      } else if (submission.status === "submitted" && wordCount > 300) {
        status = "excelling";
        statusLabel = "Doing well";
      }

      insights.push({
        teacherAction:
          status === "needs_help"
            ? "Check in during class."
            : status === "at_risk"
              ? "Review paste/declaration evidence."
              : status === "no_work"
                ? "Prompt student to begin."
                : status === "excelling"
                  ? "Extension task recommended."
                  : "Monitor progress.",
        student,
        submissionId: submission.id || null,
        assignmentTitle: submission.assignment_title || "—",
        submissionStatus: submission.status || "not_started",
        wordCount,
        pasteEvents,
        externalPasteEvents,
        declarationsCount,
        lastActivity: events[0]?.created_at || submission.submitted_at || "",
        status,
        statusLabel
      });
    }

    const priority = {
      needs_help: 1,
      at_risk: 2,
      no_work: 3,
      on_track: 4,
      excelling: 5
    };

    insights.sort((a, b) => {
      return (priority[a.status] || 9) - (priority[b.status] || 9);
    });

    const summary = {
      needs_help: insights.filter((i) => i.status === "needs_help").length,
      at_risk: insights.filter((i) => i.status === "at_risk").length,
      no_work: insights.filter((i) => i.status === "no_work").length,
      on_track: insights.filter((i) => i.status === "on_track").length,
      excelling: insights.filter((i) => i.status === "excelling").length,
      total: insights.length
    };

    res.render("teacher-insights", {
      teacher,
      classRow,
      insights,
      summary
    });
  } catch (err) {
    console.error("Insights error:", err);
    res.status(500).send(`Failed to load class insights: ${err.message}`);
  }
});

/* =========================
   TEACHER SUBMISSION REVIEW
========================= */

router.get("/submission/:id", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies?.user;
    const submissionId = Number(req.params.id);

    if (!Number.isFinite(submissionId)) {
      return res.status(400).send("Invalid submission ID");
    }

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

    const flags = computeFlags({
      events,
      declarations
    });

   const renderedHtml = applyEvidenceHighlights(
  submission.final_text || "",
  events,
  declarations
);

const composition = estimateCompositionFromHtml(renderedHtml);

res.render("teacher-review", {
  submission: {
    ...submission,
    renderedHtml
  },
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