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
import apiRoutes from "./routes/api.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================
// VIEW + MIDDLEWARE
// ======================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.APP_SECRET || "dev-secret"));
app.use(express.static(path.join(__dirname, "public")));

// ======================
// HEALTH CHECK
// ======================
app.get("/health", (req, res) => {
  res.send("ok");
});

// ======================
// TEMP DB SETUP ROUTE
// ======================
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
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        class_name TEXT NOT NULL,
        password_hash TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    res.send("Basic tables created");
  } catch (err) {
    console.error("SETUP DB ERROR:", err);
    res.status(500).send(`Setup failed: ${err.message}`);
  }


// ======================
// ROOT
// ======================
app.get("/", (req, res) => {
  res.redirect("/login");
});

// ======================
// ROUTES
// ======================
app.use("/", authRoutes);
app.use("/student", studentRoutes);
app.use("/teacher", teacherRoutes);
app.use("/teacher/assignments", assignmentRoutes);
app.use("/api", apiRoutes);

// ======================
// ERROR HANDLING
// ======================
app.use((req, res) => {
  res.status(404).send("Page not found");
});

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).send("Server error");
});

// ======================
// START SERVER
// ======================
const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Running on port ${port}`);
})