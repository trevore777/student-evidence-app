import express from "express";
import { db } from "../lib/db.js";
import requireStudent from "../middleware/requireStudent.js";

const router = express.Router();

router.get("/dashboard", requireStudent, async (req, res) => {
  try {
    const student = req.signedCookies.user;

    const assignments = await db.execute({
      sql: `
        SELECT a.*
        FROM assignments a
        JOIN students s ON s.class_name = a.class_name
        WHERE s.id = ?
        ORDER BY a.created_at DESC
      `,
      args: [student.id]
    });

    res.render("student-dashboard", {
      student,
      assignments: assignments.rows || []
    });
  } catch (err) {
    console.error("GET /student/dashboard error:", err);
    res.status(500).send("Failed to load student dashboard");
  }
});

router.get("/assignment/:id", requireStudent, async (req, res) => {
  try {
    const student = req.signedCookies.user;
    const assignmentId = Number(req.params.id);

    const assignmentResult = await db.execute({
      sql: `SELECT * FROM assignments WHERE id = ?`,
      args: [assignmentId]
    });

    const assignment = assignmentResult.rows[0];

    if (!assignment) {
      return res.status(404).send("Assignment not found");
    }

    let submissionResult = await db.execute({
      sql: `SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?`,
      args: [assignmentId, student.id]
    });

    let submission = submissionResult.rows[0];

    if (!submission) {
      await db.execute({
        sql: `INSERT INTO submissions (assignment_id, student_id, final_text, status) VALUES (?, ?, '', 'draft')`,
        args: [assignmentId, student.id]
      });

      submissionResult = await db.execute({
        sql: `SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?`,
        args: [assignmentId, student.id]
      });

      submission = submissionResult.rows[0];
    }

    const latestDraft = await db.execute({
      sql: `
        SELECT * FROM draft_snapshots
        WHERE submission_id = ?
        ORDER BY saved_at DESC
        LIMIT 1
      `,
      args: [submission.id]
    });

    res.render("writing", {
      student,
      assignment,
      submission,
      latestContent: latestDraft.rows[0]?.content || submission.final_text || ""
    });
  } catch (err) {
    console.error("GET /student/assignment/:id error:", err);
    res.status(500).send("Failed to load assignment");
  }
});

export default router;