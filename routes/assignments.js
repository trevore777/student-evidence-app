import express from "express";
import { db } from "../lib/db.js";
import requireTeacher from "../middleware/requireTeacher.js";
import { sanitizeRichText } from "../lib/sanitize.js";

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

async function getTeacherClasses(teacherId) {
  const classesResult = await db.execute({
    sql: `
      SELECT id, class_name, year_level
      FROM classes
      WHERE teacher_id = ?
      ORDER BY class_name ASC
    `,
    args: [teacherId]
  });

  return (classesResult.rows || []).map((row) =>
    normalizeRow(row, ["id", "class_name", "year_level"])
  );
}

router.get("/new", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const classes = await getTeacherClasses(teacher.id);

    res.render("assignment-form", {
      teacher,
      classes,
      error: null,
      mode: "create",
      assignment: {
        id: "",
        class_id: "",
        title: "",
        instructions: "",
        due_date: "",
        word_target: "",
        ai_policy_note: "",
        require_declaration: 1
      }
    });
  } catch (err) {
    console.error("GET /teacher/assignments/new error:", err);
    res.status(500).send("Failed to load assignment form");
  }
});

router.post("/new", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const {
      classId,
      title,
      instructions,
      dueDate,
      wordTarget,
      aiPolicyNote,
      requireDeclaration
    } = req.body;

    const classes = await getTeacherClasses(teacher.id);

    if (!classId || !title || !instructions) {
      return res.render("assignment-form", {
        teacher,
        classes,
        error: "Class, title, and instructions are required",
        mode: "create",
        assignment: {
          id: "",
          class_id: classId || "",
          title: title || "",
          instructions: instructions || "",
          due_date: dueDate || "",
          word_target: wordTarget || "",
          ai_policy_note: aiPolicyNote || "",
          require_declaration: requireDeclaration ? 1 : 0
        }
      });
    }

    const classResult = await db.execute({
      sql: `
        SELECT id, class_name
        FROM classes
        WHERE id = ? AND teacher_id = ?
      `,
      args: [Number(classId), teacher.id]
    });

    const classRow = normalizeRow(classResult.rows?.[0], ["id", "class_name"]);

    if (!classRow.id) {
      return res.render("assignment-form", {
        teacher,
        classes,
        error: "Invalid class selected",
        mode: "create",
        assignment: {
          id: "",
          class_id: classId || "",
          title: title || "",
          instructions: instructions || "",
          due_date: dueDate || "",
          word_target: wordTarget || "",
          ai_policy_note: aiPolicyNote || "",
          require_declaration: requireDeclaration ? 1 : 0
        }
      });
    }

    await db.execute({
  sql: `
    INSERT INTO assignments (
      teacher_id,
      class_id,
      title,
      instructions,
      class_name,
      due_date,
      word_target,
      ai_policy_note,
      require_declaration,
      rubric_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  args: [
    teacher.id,
    classRow.id,
    title.trim(),
    sanitizeRichText(instructions),
    classRow.class_name,
    dueDate || "",
    wordTarget ? Number(wordTarget) : null,
    sanitizeRichText(aiPolicyNote || ""),
    requireDeclaration ? 1 : 0,
    sanitizeRichText(rubricText || "")
  ]
});

    res.redirect("/teacher/dashboard");
  } catch (err) {
    console.error("POST /teacher/assignments/new error:", err);
    res.status(500).send("Failed to create assignment");
  }
});

router.get("/:id/edit", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const assignmentId = Number(req.params.id);

    const classes = await getTeacherClasses(teacher.id);

    const assignmentResult = await db.execute({
      sql: `
        SELECT
          id,
          class_id,
          title,
          instructions,
          due_date,
          word_target,
          ai_policy_note,
          require_declaration
        FROM assignments
        WHERE id = ? AND teacher_id = ?
      `,
      args: [assignmentId, teacher.id]
    });

    const assignment = normalizeRow(assignmentResult.rows?.[0], [
      "id",
      "class_id",
      "title",
      "instructions",
      "due_date",
      "word_target",
      "ai_policy_note",
      "require_declaration"
    ]);

    if (!assignment.id) {
      return res.status(404).send("Assignment not found");
    }

    res.render("assignment-form", {
      teacher,
      classes,
      error: null,
      mode: "edit",
      assignment
    });
  } catch (err) {
    console.error("GET /teacher/assignments/:id/edit error:", err);
    res.status(500).send("Failed to load assignment editor");
  }
});

router.post("/:id/edit", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const assignmentId = Number(req.params.id);

    const {
  classId,
  title,
  instructions,
  dueDate,
  wordTarget,
  aiPolicyNote,
  requireDeclaration,
  rubricText
} = req.body;

    const classes = await getTeacherClasses(teacher.id);

    if (!classId || !title || !instructions) {
      return res.render("assignment-form", {
        teacher,
        classes,
        error: "Class, title, and instructions are required",
        mode: "edit",
        assignment: {
          id: assignmentId,
          class_id: classId || "",
          title: title || "",
          instructions: instructions || "",
          due_date: dueDate || "",
          word_target: wordTarget || "",
          ai_policy_note: aiPolicyNote || "",
          require_declaration: requireDeclaration ? 1 : 0
        }
      });
    }

    const classResult = await db.execute({
      sql: `
        SELECT id, class_name
        FROM classes
        WHERE id = ? AND teacher_id = ?
      `,
      args: [Number(classId), teacher.id]
    });

    const classRow = normalizeRow(classResult.rows?.[0], ["id", "class_name"]);

    if (!classRow.id) {
      return res.render("assignment-form", {
        teacher,
        classes,
        error: "Invalid class selected",
        mode: "edit",
        assignment: {
          id: assignmentId,
          class_id: classId || "",
          title: title || "",
          instructions: instructions || "",
          due_date: dueDate || "",
          word_target: wordTarget || "",
          ai_policy_note: aiPolicyNote || "",
          require_declaration: requireDeclaration ? 1 : 0
        }
      });
    }

    await db.execute({
      sql: `
        UPDATE assignments
        SET
          class_id = ?,
          class_name = ?,
          title = ?,
          instructions = ?,
          due_date = ?,
          word_target = ?,
          ai_policy_note = ?,
          require_declaration = ?
          rubric_text = ?
        WHERE id = ? AND teacher_id = ?
      `,
      args: [
        classRow.id,
    classRow.class_name,
    title.trim(),
    sanitizeRichText(instructions),
    dueDate || "",
    wordTarget ? Number(wordTarget) : null,
    sanitizeRichText(aiPolicyNote || ""),
    requireDeclaration ? 1 : 0,
    sanitizeRichText(rubricText || ""),
    assignmentId,
    teacher.id
      ]
    });

    res.redirect("/teacher/dashboard");
  } catch (err) {
    console.error("POST /teacher/assignments/:id/edit error:", err);
    res.status(500).send("Failed to update assignment");
  }
});

export default router;