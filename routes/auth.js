import express from "express";
import { db } from "../lib/db.js";
//import { comparePassword } from "../lib/auth.js";
import { comparePassword, hashPassword } from "../lib/auth.js";

const router = express.Router();

/* REGISTER PAGE */
router.get("/register", (req, res) => {
  res.render("register", {
    error: null
  });
});

/* REGISTER SUBMIT */
router.post("/register", async (req, res) => {
  try {

    const {
      name,
      email,
      password
    } = req.body || {};

    if (!name || !email || !password) {
      return res.render("register", {
        error: "All fields are required"
      });
    }

    const existing = await db.execute({
      sql: `
        SELECT id
        FROM teachers
        WHERE email = ?
      `,
      args: [email]
    });

    if (existing.rows?.length) {
      return res.render("register", {
        error: "An account with this email already exists"
      });
    }

    const passwordHash = await hashPassword(password);

    await db.execute({
      sql: `
        INSERT INTO teachers (
          name,
          email,
          password_hash,
          plan
        )
        VALUES (?, ?, ?, 'free')
      `,
      args: [
        name,
        email,
        passwordHash
      ]
    });

    const result = await db.execute({
      sql: `
        SELECT id, name, plan
        FROM teachers
        WHERE email = ?
      `,
      args: [email]
    });

    const teacher = result.rows?.[0];

    res.cookie(
      "user",
      {
        id: teacher.id,
        name: teacher.name,
        role: "teacher",
        plan: teacher.plan || "free"
      },
      {
        signed: true,
        httpOnly: true,
        sameSite: "strict",
        secure: true
      }
    );

    return res.redirect("/teacher/dashboard");

  } catch (err) {
    console.error("POST /register error:", err);

    res.render("register", {
      error: "Failed to create account"
    });
  }
});


function normalizeRow(row, keys = []) {
  if (!row) return {};
  if (!Array.isArray(row)) return row;

  const obj = {};
  keys.forEach((key, i) => {
    obj[key] = row[i];
  });

  return obj;
}

async function getTeachers() {
  const result = await db.execute(`
    SELECT id, name, email
    FROM teachers
    ORDER BY name ASC
  `);

  return (result.rows || []).map((row) =>
    normalizeRow(row, ["id", "name", "email"])
  );
}

/* LOGIN PAGE */
router.get("/login", async (req, res) => {
  try {
    const teachers = await getTeachers();

    res.render("login", {
      error: null,
      teachers
    });
  } catch (err) {
    console.error("GET /login error:", err);
    res.status(500).send("Failed to load login page");
  }
});


/* LOGIN SUBMIT */
router.post("/login", async (req, res) => {
  try {
    const body = req.body || {};
    const { role } = body;

    if (role === "teacher") {
      const { email, password } = body;

      const result = await db.execute({
        sql: `
          SELECT
            id,
            name,
            email,
            password_hash,
            class_name,
            plan
          FROM teachers
          WHERE email = ?
        `,
        args: [email]
      });

      const user = normalizeRow(result.rows?.[0], [
        "id",
        "name",
        "email",
        "password_hash",
        "class_name",
        "plan"
      ]);

      if (!user.id) {
        return res.render("login", {
          error: "Invalid login details",
          teachers: await getTeachers()
        });
      }

      const valid = await comparePassword(password, user.password_hash);

      if (!valid) {
        return res.render("login", {
          error: "Invalid login details",
          teachers: await getTeachers()
        });
      }

      res.cookie(
        "user",
        {
          id: user.id,
          name: user.name,
          role: "teacher",
          class_name: user.class_name || "",
          plan: user.plan || "free"
        },
        {
          signed: true,
          httpOnly: true,
          sameSite: "strict",
          secure: true
        }
      );

      return res.redirect("/teacher/dashboard");
    }

    const { teacherId, classId, studentId, studentPin } = body;

    const result = await db.execute({
      sql: `
        SELECT
          s.id,
          s.name,
          c.class_name,
          s.student_pin,
          s.pin_needs_reset
        FROM students s
        JOIN classes c ON c.id = s.class_id
        WHERE s.id = ?
          AND s.class_id = ?
          AND c.teacher_id = ?
      `,
      args: [
        studentId,
        classId,
        teacherId
      ]
    });

    const student = normalizeRow(result.rows?.[0], [
      "id",
      "name",
      "class_name",
      "student_pin",
      "pin_needs_reset"
    ]);

    if (!student.id) {
      return res.render("login", {
        error: "Please select a valid student",
        teachers: await getTeachers()
      });
    }

    if (String(student.student_pin || "") !== String(studentPin || "").trim()) {
      return res.render("login", {
        error: "Invalid student PIN",
        teachers: await getTeachers()
      });
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
        sameSite: "strict",
        secure: true
      }
    );

    if (Number(student.pin_needs_reset) === 1) {
      return res.redirect("/student/change-pin");
    }

    return res.redirect("/student/dashboard");
  } catch (err) {
    console.error("POST /login error:", err);
    res.status(500).send("Login failed");
  }
});

/* LOGOUT */
router.get("/logout", (req, res) => {
  res.clearCookie("user");
  res.redirect("/login");
});

export default router;