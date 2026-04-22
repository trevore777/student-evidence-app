import express from "express";
import multer from "multer";
import { db } from "../lib/db.js";
import requireTeacher from "../middleware/requireTeacher.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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

function parseCsvLine(line = "") {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function parseCsv(text = "") {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return row;
  });
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
      error: null,
      success: null
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
        error: "Student name is required",
        success: null
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

router.post("/:id/students/import", requireTeacher, upload.single("csvFile"), async (req, res) => {
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

    if (!req.file) {
      return res.render("teacher-class-students", {
        teacher,
        classItem: classRow,
        students,
        error: "Please upload a CSV file",
        success: null
      });
    }

    const csvText = req.file.buffer.toString("utf8");
    const rows = parseCsv(csvText);

    if (!rows.length) {
      return res.render("teacher-class-students", {
        teacher,
        classItem: classRow,
        students,
        error: "CSV file appears to be empty",
        success: null
      });
    }

    let inserted = 0;

    for (const row of rows) {
      const name = (row.name || "").trim();
      const email = (row.email || "").trim();
      const pin = (row.pin || row.student_pin || "").trim() || "1234";

      if (!name) continue;

      await db.execute({
        sql: `
          INSERT INTO students (class_id, class_name, name, email, student_pin, password_hash)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        args: [
          classId,
          classRow.class_name,
          name,
          email,
          pin,
          "unused"
        ]
      });

      inserted++;
    }

    const refreshedStudentsResult = await db.execute({
      sql: `
        SELECT id, name, email, student_pin, created_at
        FROM students
        WHERE class_id = ?
        ORDER BY name ASC
      `,
      args: [classId]
    });

    const refreshedStudents = (refreshedStudentsResult.rows || []).map((row) =>
      normalizeRow(row, ["id", "name", "email", "student_pin", "created_at"])
    );

    res.render("teacher-class-students", {
      teacher,
      classItem: classRow,
      students: refreshedStudents,
      error: null,
      success: `${inserted} students imported successfully`
    });
  } catch (err) {
    console.error("POST /teacher/classes/:id/students/import error:", err);
    res.status(500).send("Failed to import CSV");
  }
});

export default router;