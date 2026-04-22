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

function generateJoinCode(className = "", teacherName = "") {
  const classPart = String(className)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6) || "CLASS";

  const teacherPart = String(teacherName)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3) || "TCH";

  const randomPart = Math.floor(1000 + Math.random() * 9000);

  return `${classPart}-${teacherPart}-${randomPart}`;
}

router.get("/", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;

    const classesResult = await db.execute({
      sql: `
        SELECT id, class_name, year_level, join_code, created_at
        FROM classes
        WHERE teacher_id = ?
        ORDER BY created_at DESC
      `,
      args: [teacher.id]
    });

    const classes = (classesResult.rows || []).map((row) =>
      normalizeRow(row, ["id", "class_name", "year_level", "join_code", "created_at"])
    );

    res.render("teacher-classes", {
      teacher,
      classes,
      error: null
    });
  } catch (err) {
    console.error("GET /teacher/classes error:", err);
    res.status(500).send("Failed to load classes");
  }
});

router.post("/new", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const { className, yearLevel } = req.body;

    const classesResult = await db.execute({
      sql: `
        SELECT id, class_name, year_level, join_code, created_at
        FROM classes
        WHERE teacher_id = ?
        ORDER BY created_at DESC
      `,
      args: [teacher.id]
    });

    const classes = (classesResult.rows || []).map((row) =>
      normalizeRow(row, ["id", "class_name", "year_level", "join_code", "created_at"])
    );

    if (!className || !className.trim()) {
      return res.render("teacher-classes", {
        teacher,
        classes,
        error: "Class name is required"
      });
    }

    const joinCode = generateJoinCode(className, teacher.name);

    await db.execute({
      sql: `
        INSERT INTO classes (teacher_id, class_name, year_level, join_code)
        VALUES (?, ?, ?, ?)
      `,
      args: [teacher.id, className.trim(), yearLevel?.trim() || "", joinCode]
    });

    res.redirect("/teacher/classes");
  } catch (err) {
    console.error("POST /teacher/classes/new error:", err);
    res.status(500).send("Failed to create class");
  }
});

router.get("/:id/students", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const classId = Number(req.params.id);

    const classResult = await db.execute({
      sql: `
        SELECT id, class_name, year_level, join_code
        FROM classes
        WHERE id = ? AND teacher_id = ?
      `,
      args: [classId, teacher.id]
    });

    const classRow = normalizeRow(classResult.rows?.[0], [
      "id",
      "class_name",
      "year_level",
      "join_code"
    ]);

    if (!classRow.id) {
      return res.status(404).send("Class not found");
    }

    const studentsResult = await db.execute({
      sql: `
        SELECT id, name, email, student_pin, created_at
        FROM students
        WHERE class_id = ?
        ORDER BY name ASC
      `,
      args: [classId]
    });

    const students = (studentsResult.rows || []).map((row) =>
      normalizeRow(row, ["id", "name", "email", "student_pin", "created_at"])
    );

    res.render("teacher-class-students", {
      teacher,
      classItem: classRow,
      students,
      error: null
    });
  } catch (err) {
    console.error("GET /teacher/classes/:id/students error:", err);
    res.status(500).send("Failed to load students");
  }
});

router.post("/:id/students/new", requireTeacher, async (req, res) => {
  try {
    const teacher = req.signedCookies.user;
    const classId = Number(req.params.id);
    const { studentName, studentEmail, studentPin } = req.body;

    const classResult = await db.execute({
      sql: `
        SELECT id, class_name, year_level, join_code
        FROM classes
        WHERE id = ? AND teacher_id = ?
      `,
      args: [classId, teacher.id]
    });

    const classRow = normalizeRow(classResult.rows?.[0], [
      "id",
      "class_name",
      "year_level",
      "join_code"
    ]);

    if (!classRow.id) {
      return res.status(404).send("Class not found");
    }

    const studentsResult = await db.execute({
      sql: `
        SELECT id, name, email, student_pin, created_at
        FROM students
        WHERE class_id = ?
        ORDER BY name ASC
      `,
      args: [classId]
    });

    const students = (studentsResult.rows || []).map((row) =>
      normalizeRow(row, ["id", "name", "email", "student_pin", "created_at"])
    );

    if (!studentName || !studentName.trim()) {
      return res.render("teacher-class-students", {
        teacher,
        classItem: classRow,
        students,
        error: "Student name is required"
      });
    }

    await db.execute({
      sql: `
        INSERT INTO students (class_id, class_name, name, email, student_pin, password_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [
        classId,
        classRow.class_name,
        studentName.trim(),
        studentEmail?.trim() || "",
        studentPin?.trim() || "1234",
        "unused"
      ]
    });

    res.redirect(`/teacher/classes/${classId}/students`);
  } catch (err) {
    console.error("POST /teacher/classes/:id/students/new error:", err);
    res.status(500).send("Failed to add student");
  }
});

export default router;