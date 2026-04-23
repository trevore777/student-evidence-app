import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

import { db } from "./lib/db.js";

import authRoutes from "./routes/auth.js";
import studentRoutes from "./routes/student.js";
import teacherRoutes from "./routes/teacher.js";
import assignmentRoutes from "./routes/assignments.js";
import classRoutes from "./routes/classes.js";
import apiRoutes from "./routes/api.js";
import printRoutes from "./routes/print.js";
import uploadRoutes from "./routes/upload.js";

app.use("/api/upload", uploadRoutes);

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// views + middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.APP_SECRET || "dev-secret"));
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/tinymce", express.static(path.join(__dirname, "node_modules", "tinymce")));
app.use("/teacher/print", printRoutes);
app.use("/uploads", express.static("uploads"));
// health check
app.get("/health", (req, res) => {
  res.send("ok");
});

// DEV ONLY ROUTES
if (process.env.NODE_ENV !== "production") {
  app.get("/db-probe", async (req, res) => {
    try {
      const result = await db.execute("SELECT 1 as ok");
      res.json({
        ok: true,
        rows: result.rows
      });
    } catch (err) {
      console.error("DB PROBE ERROR:", err);
      res.status(500).json({
        ok: false,
        message: err.message,
        code: err.code || null
      });
    }
  });

  app.get("/setup-db", async (req, res) => {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS teachers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          class_name TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS classes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teacher_id INTEGER NOT NULL,
          class_name TEXT NOT NULL,
          year_level TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS students (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          class_id INTEGER,
          name TEXT NOT NULL,
          email TEXT,
          class_name TEXT NOT NULL,
          password_hash TEXT,
          student_pin TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teacher_id INTEGER NOT NULL,
          class_id INTEGER,
          title TEXT NOT NULL,
          instructions TEXT NOT NULL,
          class_name TEXT NOT NULL,
          due_date TEXT,
          word_target INTEGER,
          ai_policy_note TEXT,
          require_declaration INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          assignment_id INTEGER NOT NULL,
          student_id INTEGER NOT NULL,
          final_text TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          submitted_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS writing_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          submission_id INTEGER NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          active_seconds INTEGER NOT NULL DEFAULT 0,
          idle_seconds INTEGER NOT NULL DEFAULT 0,
          device_info TEXT
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS draft_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          submission_id INTEGER NOT NULL,
          session_id INTEGER NOT NULL,
          content TEXT NOT NULL,
          word_count INTEGER NOT NULL DEFAULT 0,
          saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS editor_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          submission_id INTEGER NOT NULL,
          session_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          event_meta TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS source_declarations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          submission_id INTEGER NOT NULL,
          session_id INTEGER NOT NULL,
          declaration_type TEXT NOT NULL,
          tool_name TEXT,
          prompt_text TEXT,
          original_text_excerpt TEXT,
          student_explanation TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS submission_flags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          submission_id INTEGER NOT NULL,
          flag_code TEXT NOT NULL,
          flag_message TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'info',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      try { await db.execute(`ALTER TABLE students ADD COLUMN student_pin TEXT`); } catch {}
      try { await db.execute(`ALTER TABLE students ADD COLUMN class_id INTEGER`); } catch {}
      try { await db.execute(`ALTER TABLE teachers ADD COLUMN class_name TEXT`); } catch {}
      try { await db.execute(`ALTER TABLE assignments ADD COLUMN class_id INTEGER`); } catch {}
      try { await db.execute(`ALTER TABLE assignments ADD COLUMN word_target INTEGER`); } catch {}
      try { await db.execute(`ALTER TABLE assignments ADD COLUMN ai_policy_note TEXT`); } catch {}
      try { await db.execute(`ALTER TABLE assignments ADD COLUMN require_declaration INTEGER NOT NULL DEFAULT 1`); } catch {}

      res.send("Database tables created");
    } catch (err) {
      console.error("SETUP DB ERROR:", err);
      res.status(500).send(`Setup failed: ${err.message}`);
    }
  });
}

// root
app.get("/", (req, res) => {
  res.redirect("/login");
});

// routes
app.use("/", authRoutes);
app.use("/student", studentRoutes);
app.use("/teacher", teacherRoutes);
app.use("/teacher/assignments", assignmentRoutes);
app.use("/teacher/classes", classRoutes);
app.use("/api", apiRoutes);

// error handling
app.use((req, res) => {
  res.status(404).send("Page not found");
});

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).send("Server error");
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Running on port ${port}`);
});