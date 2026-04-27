import express from "express";
import { db } from "../lib/db.js";
import requireStudent from "../middleware/requireStudent.js";

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

/* CHANGE PIN PAGE */
router.get("/change-pin", requireStudent, async (req, res) => {
  try {
    const student = req.signedCookies.user;

    res.render("change-pin", {
      student,
      error: null,
      success: null
    });
  } catch (err) {
    console.error("GET /student/change-pin error:", err);
    res.status(500).send("Failed to load change PIN page");
  }
});

/* SAVE NEW PIN */
router.post("/change-pin", requireStudent, async (req, res) => {
  try {
    const student = req.signedCookies.user;
    const { currentPin, newPin, confirmPin } = req.body || {};

    const result = await db.execute({
      sql: `
        SELECT id, student_pin
        FROM students
        WHERE id = ?
      `,
      args: [student.id]
    });

    const studentRow = normalizeRow(result.rows?.[0], ["id", "student_pin"]);

    if (!studentRow.id) {
      return res.status(404).send("Student not found");
    }

    if (String(currentPin || "").trim() !== String(studentRow.student_pin || "").trim()) {
      return res.render("change-pin", {
        student,
        error: "Current PIN is incorrect",
        success: null
      });
    }

    if (!/^\d{4}$/.test(String(newPin || "").trim())) {
      return res.render("change-pin", {
        student,
        error: "New PIN must be exactly 4 digits",
        success: null
      });
    }

    if (String(newPin).trim() !== String(confirmPin || "").trim()) {
      return res.render("change-pin", {
        student,
        error: "PIN confirmation does not match",
        success: null
      });
    }

    await db.execute({
      sql: `
        UPDATE students
        SET student_pin = ?, pin_needs_reset = 0
        WHERE id = ?
      `,
      args: [String(newPin).trim(), student.id]
    });

    res.redirect("/student/dashboard");
  } catch (err) {
    console.error("POST /student/change-pin error:", err);
    res.status(500).send("Failed to change PIN");
  }
});

/* STUDENT DASHBOARD */
router.get("/dashboard", requireStudent, async (req, res) => {
  try {
    const loggedInStudent = req.signedCookies.user;

    const studentResult = await db.execute({
      sql: `
        SELECT id, name, class_id, class_name
        FROM students
        WHERE id = ?
      `,
      args: [loggedInStudent.id]
    });

    const studentRecord = normalizeRow(studentResult.rows?.[0], [
      "id",
      "name",
      "class_id",
      "class_name"
    ]);

    if (!studentRecord.id) {
      return res.status(404).send("Student not found");
    }

    const assignmentsResult = await db.execute({
      sql: `
        SELECT
          id,
          title,
          instructions,
          due_date,
          word_target,
          ai_policy_note,
          require_declaration,
          created_at
        FROM assignments
        WHERE class_id = ?
        ORDER BY created_at DESC
      `,
      args: [studentRecord.class_id]
    });

    const assignments = (assignmentsResult.rows || []).map((row) =>
      normalizeRow(row, [
        "id",
        "title",
        "instructions",
        "due_date",
        "word_target",
        "ai_policy_note",
        "require_declaration",
        "created_at"
      ])
    );

    const examsResult = await db.execute({
      sql: `
        SELECT
          id,
          title,
          instructions,
          created_at
        FROM exams
        WHERE class_id = ?
        ORDER BY created_at DESC
      `,
      args: [studentRecord.class_id]
    });

    const exams = (examsResult.rows || []).map((row) =>
      normalizeRow(row, [
        "id",
        "title",
        "instructions",
        "created_at"
      ])
    );

    res.render("student-dashboard", {
      student: {
        ...loggedInStudent,
        id: studentRecord.id,
        name: studentRecord.name,
        class_id: studentRecord.class_id,
        class_name: studentRecord.class_name
      },
      assignments,
      exams
    });
  } catch (err) {
    console.error("GET /student/dashboard error:", err);
    res.status(500).send(`Failed to load student dashboard: ${err.message}`);
  }
});

/* STUDENT WRITING ASSIGNMENT */
router.get("/assignment/:id", requireStudent, async (req, res) => {
  try {
    const student = req.signedCookies.user;
    const assignmentId = Number(req.params.id);

    const studentResult = await db.execute({
      sql: `
        SELECT id, class_id, class_name
        FROM students
        WHERE id = ?
      `,
      args: [student.id]
    });

    const studentRecord = normalizeRow(studentResult.rows?.[0], [
      "id",
      "class_id",
      "class_name"
    ]);

    if (!studentRecord.id) {
      return res.status(404).send("Student not found");
    }

    const assignmentResult = await db.execute({
      sql: `
        SELECT
          id,
          teacher_id,
          class_id,
          title,
          instructions,
          class_name,
          due_date,
          word_target,
          ai_policy_note,
          require_declaration,
          created_at
        FROM assignments
        WHERE id = ? AND class_id = ?
      `,
      args: [assignmentId, studentRecord.class_id]
    });

    const assignment = normalizeRow(assignmentResult.rows?.[0], [
      "id",
      "teacher_id",
      "class_id",
      "title",
      "instructions",
      "class_name",
      "due_date",
      "word_target",
      "ai_policy_note",
      "require_declaration",
      "created_at"
    ]);

    if (!assignment.id) {
      return res.status(404).send("Assignment not found");
    }

    let submissionResult = await db.execute({
      sql: `
        SELECT id, assignment_id, student_id, final_text, status, submitted_at, created_at
        FROM submissions
        WHERE assignment_id = ? AND student_id = ?
      `,
      args: [assignmentId, student.id]
    });

    let submission = normalizeRow(submissionResult.rows?.[0], [
      "id",
      "assignment_id",
      "student_id",
      "final_text",
      "status",
      "submitted_at",
      "created_at"
    ]);

    if (!submission.id) {
      await db.execute({
        sql: `
          INSERT INTO submissions (assignment_id, student_id, final_text, status)
          VALUES (?, ?, '', 'draft')
        `,
        args: [assignmentId, student.id]
      });

      submissionResult = await db.execute({
        sql: `
          SELECT id, assignment_id, student_id, final_text, status, submitted_at, created_at
          FROM submissions
          WHERE assignment_id = ? AND student_id = ?
        `,
        args: [assignmentId, student.id]
      });

      submission = normalizeRow(submissionResult.rows?.[0], [
        "id",
        "assignment_id",
        "student_id",
        "final_text",
        "status",
        "submitted_at",
        "created_at"
      ]);
    }

    const latestDraftResult = await db.execute({
      sql: `
        SELECT id, content, word_count, saved_at
        FROM draft_snapshots
        WHERE submission_id = ?
        ORDER BY saved_at DESC
        LIMIT 1
      `,
      args: [submission.id]
    });

    const latestDraft = normalizeRow(latestDraftResult.rows?.[0], [
      "id",
      "content",
      "word_count",
      "saved_at"
    ]);

    res.render("writing", {
      student: {
        ...student,
        class_name: studentRecord.class_name
      },
      assignment,
      submission,
      latestContent: latestDraft.content || submission.final_text || ""
    });
  } catch (err) {
    console.error("GET /student/assignment/:id error:", err);
    res.status(500).send(`Failed to load assignment: ${err.message}`);
  }
});

export default router;