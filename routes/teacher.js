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

function formatDate(dt) {
  if (!dt) return "";

  const date = new Date(dt);

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");

  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
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
      exams.forEach((exam) => {
  exam.created_at_fmt = formatDate(exam.created_at);
});
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


router.get("/class/:classId/insights", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const classId = Number(req.params.classId);

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

    res.render("teacher-insights", {
  teacher,
  classRow,
  insights,
  summary
});
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
  needs_help: insights.filter(i => i.status === "needs_help").length,
  at_risk: insights.filter(i => i.status === "at_risk").length,
  no_work: insights.filter(i => i.status === "no_work").length,
  on_track: insights.filter(i => i.status === "on_track").length,
  excelling: insights.filter(i => i.status === "excelling").length,
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