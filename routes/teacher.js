import express from "express";
import { db } from "../lib/db.js";
import requireTeacher from "../middleware/requireTeacher.js";
import { computeFlags, estimateComposition } from "../lib/flags.js";

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

router.get("/dashboard", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const selectedClass = teacher.class_name || req.query.class || "";
    const flaggedOnly = req.query.flagged === "1";

    const assignmentResult = await db.execute({
      sql: `
        SELECT id, teacher_id, title, instructions, class_name, due_date, word_target, ai_policy_note, require_declaration, created_at
        FROM assignments
        WHERE teacher_id = ? AND class_name = ?
        ORDER BY created_at DESC
      `,
      args: [teacher.id, selectedClass]
    });

    const assignments = (assignmentResult.rows || []).map((row) =>
      normalizeRow(row, [
        "id",
        "teacher_id",
        "title",
        "instructions",
        "class_name",
        "due_date",
        "word_target",
        "ai_policy_note",
        "require_declaration",
        "created_at"
      ])
    );

    const submissionsResult = await db.execute({
      sql: `
        SELECT
          sub.id,
          sub.status,
          sub.submitted_at,
          sub.final_text,
          s.name AS student_name,
          s.class_name,
          a.title AS assignment_title,
          a.id AS assignment_id
        FROM submissions sub
        JOIN students s ON s.id = sub.student_id
        JOIN assignments a ON a.id = sub.assignment_id
        WHERE a.teacher_id = ? AND a.class_name = ?
        ORDER BY sub.created_at DESC
      `,
      args: [teacher.id, selectedClass]
    });

    const submissionsRaw = (submissionsResult.rows || []).map((row) =>
      normalizeRow(row, [
        "id",
        "status",
        "submitted_at",
        "final_text",
        "student_name",
        "class_name",
        "assignment_title",
        "assignment_id"
      ])
    );

    const enriched = [];
    for (const row of submissionsRaw) {
      const [eventsResult, declarationsResult, sessionsResult] = await Promise.all([
        db.execute({
          sql: `SELECT event_type, event_meta, created_at FROM editor_events WHERE submission_id = ? ORDER BY created_at ASC`,
          args: [row.id]
        }),
        db.execute({
          sql: `
            SELECT declaration_type, tool_name, prompt_text, original_text_excerpt, student_explanation, created_at
            FROM source_declarations
            WHERE submission_id = ?
            ORDER BY created_at ASC
          `,
          args: [row.id]
        }),
        db.execute({
          sql: `
            SELECT started_at, ended_at, active_seconds, idle_seconds, device_info
            FROM writing_sessions
            WHERE submission_id = ?
            ORDER BY started_at ASC
          `,
          args: [row.id]
        })
      ]);

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
          "created_at"
        ])
      );

      const sessions = (sessionsResult.rows || []).map((row) =>
        normalizeRow(row, [
          "started_at",
          "ended_at",
          "active_seconds",
          "idle_seconds",
          "device_info"
        ])
      );

      const flags = computeFlags({
        events,
        declarations,
        sessions,
        finalText: row.final_text || ""
      });

      enriched.push({ ...row, flags });
    }

    const submissions = flaggedOnly
      ? enriched.filter((r) => r.flags.length > 0)
      : enriched;

    res.render("teacher-dashboard", {
      teacher,
      assignments,
      submissions,
      classes: selectedClass ? [selectedClass] : [],
      selectedClass,
      flaggedOnly
    });
  } catch (err) {
    console.error("GET /teacher/dashboard error:", err);
    res.status(500).send("Failed to load teacher dashboard");
  }
});

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
          s.class_name,
          a.title AS assignment_title,
          a.instructions
        FROM submissions sub
        JOIN students s ON s.id = sub.student_id
        JOIN assignments a ON a.id = sub.assignment_id
        WHERE sub.id = ? AND a.teacher_id = ? AND a.class_name = ?
      `,
      args: [submissionId, teacher.id, teacher.class_name || ""]
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
      "instructions"
    ]);

    if (!submission.id) {
      return res.status(404).send("Submission not found");
    }

    const [sessionsResult, eventsResult, declarationsResult, snapshotsResult] = await Promise.all([
      db.execute({
        sql: `
          SELECT started_at, ended_at, active_seconds, idle_seconds, device_info
          FROM writing_sessions
          WHERE submission_id = ?
          ORDER BY started_at ASC
        `,
        args: [submissionId]
      }),
      db.execute({
        sql: `
          SELECT event_type, event_meta, created_at
          FROM editor_events
          WHERE submission_id = ?
          ORDER BY created_at ASC
        `,
        args: [submissionId]
      }),
      db.execute({
        sql: `
          SELECT declaration_type, tool_name, prompt_text, original_text_excerpt, student_explanation, created_at
          FROM source_declarations
          WHERE submission_id = ?
          ORDER BY created_at ASC
        `,
        args: [submissionId]
      }),
      db.execute({
        sql: `
          SELECT id, content, word_count, saved_at
          FROM draft_snapshots
          WHERE submission_id = ?
          ORDER BY saved_at ASC
        `,
        args: [submissionId]
      })
    ]);

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
    res.status(500).send("Failed to load teacher review");
  }
});

export default router;