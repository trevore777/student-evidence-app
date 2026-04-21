import express from "express";
import { db } from "../lib/db.js";
import { comparePassword, hashPassword } from "../lib/auth.js";

const router = express.Router();

async function getClasses() {
  const classesResult = await db.execute(`
    SELECT DISTINCT class_name
    FROM students
    ORDER BY class_name
  `);
  return classesResult.rows;
}

router.get("/login", async (req, res) => {
  const classes = await getClasses();
  res.render("login", { error: null, classes });
});

router.get("/seed-demo-users", async (req, res) => {
  try {
    const teacherHash = await hashPassword("teacher123");

    await db.execute({
      sql: `INSERT OR IGNORE INTO teachers (name, email, password_hash, class_name) VALUES (?, ?, ?, ?)`,
      args: ["Demo Teacher", "teacher@test.com", teacherHash, "Year 10A"]
    });

    await db.execute({
      sql: `INSERT OR IGNORE INTO teachers (name, email, password_hash, class_name) VALUES (?, ?, ?, ?)`,
      args: ["Ms Baker", "baker@test.com", teacherHash, "Year 10B"]
    });

    await db.execute({
      sql: `INSERT OR IGNORE INTO students (name, email, class_name, password_hash) VALUES (?, ?, ?, ?)`,
      args: ["Demo Student", "student@test.com", "Year 10A", "unused"]
    });

    await db.execute({
      sql: `INSERT OR IGNORE INTO students (name, email, class_name, password_hash) VALUES (?, ?, ?, ?)`,
      args: ["Ella Brown", "ella@test.com", "Year 10A", "unused"]
    });

    await db.execute({
      sql: `INSERT OR IGNORE INTO students (name, email, class_name, password_hash) VALUES (?, ?, ?, ?)`,
      args: ["Noah Smith", "noah@test.com", "Year 10B", "unused"]
    });

    await db.execute({
      sql: `INSERT OR IGNORE INTO students (name, email, class_name, password_hash) VALUES (?, ?, ?, ?)`,
      args: ["Ruby Jones", "ruby@test.com", "Year 10B", "unused"]
    });

    const teacherA = await db.execute({
      sql: `SELECT id FROM teachers WHERE email = ?`,
      args: ["teacher@test.com"]
    });

    const teacherB = await db.execute({
      sql: `SELECT id FROM teachers WHERE email = ?`,
      args: ["baker@test.com"]
    });

    await db.execute({
      sql: `INSERT OR IGNORE INTO assignments
            (id, teacher_id, title, instructions, class_name, due_date, word_target, ai_policy_note, require_declaration)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        1,
        teacherA.rows[0].id,
        "AI and Academic Integrity Reflection",
        "Write a reflection explaining how you used AI appropriately in this task.",
        "Year 10A",
        "2026-05-01",
        400,
        "Declare any pasted or AI-assisted content honestly.",
        1
      ]
    });

    await db.execute({
      sql: `INSERT OR IGNORE INTO assignments
            (id, teacher_id, title, instructions, class_name, due_date, word_target, ai_policy_note, require_declaration)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        2,
        teacherB.rows[0].id,
        "Evaluating Sources",
        "Compare two sources and explain which is more reliable.",
        "Year 10B",
        "2026-05-08",
        500,
        "Use the declaration tools if you paste notes or use AI assistance.",
        1
      ]
    });

    res.send("Demo users seeded");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to seed demo users");
  }
});

router.post("/login", async (req, res) => {
  const { role } = req.body;

  if (role === "teacher") {
    const { email, password } = req.body;

    const result = await db.execute({
      sql: `SELECT * FROM teachers WHERE email = ?`,
      args: [email]
    });

    const user = result.rows[0];
    if (!user) {
      return res.render("login", { error: "Invalid login details", classes: await getClasses() });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.render("login", { error: "Invalid login details", classes: await getClasses() });
    }

    res.cookie(
      "user",
      { id: user.id, name: user.name, role: "teacher", class_name: user.class_name || "" },
      {
        signed: true,
        httpOnly: true,
        sameSite: "lax"
      }
    );

    return res.redirect("/teacher/dashboard");
  }

  const { studentId } = req.body;

  const result = await db.execute({
    sql: `SELECT * FROM students WHERE id = ?`,
    args: [studentId]
  });

  const student = result.rows[0];
  if (!student) {
    return res.render("login", { error: "Please select a valid student", classes: await getClasses() });
  }

  res.cookie(
    "user",
    {
      id: student.id,
      name: student.name,
      role: "student",
      class_name: student.class_name
    },
    {
      signed: true,
      httpOnly: true,
      sameSite: "lax"
    }
  );

  return res.redirect("/student/dashboard");
});

router.get("/logout", (req, res) => {
  res.clearCookie("user");
  res.redirect("/login");
});

export default router;