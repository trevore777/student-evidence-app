import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.js";
import studentRoutes from "./routes/student.js";
import teacherRoutes from "./routes/teacher.js";
import assignmentRoutes from "./routes/assignments.js";
import classRoutes from "./routes/classes.js";
import apiRoutes from "./routes/api.js";
import uploadRoutes from "./routes/upload.js";
import printRoutes from "./routes/print.js";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/* VIEW ENGINE — MUST COME BEFORE ROUTES */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* BODY + COOKIE PARSING — MUST COME BEFORE ROUTES */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.APP_SECRET || "dev-secret"));

/* STATIC FILES */
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/tinymce", express.static(path.join(__dirname, "node_modules", "tinymce")));
app.use("/uploads", express.static(uploadsDir));

/* HEALTH CHECK */
app.get("/health", (req, res) => {
  res.send("ok");
});

/* HOME */
app.get("/", (req, res) => {
  res.redirect("/login");
});

/* ROUTES */
app.use("/", authRoutes);
app.use("/student", studentRoutes);
app.use("/teacher", teacherRoutes);
app.use("/teacher/assignments", assignmentRoutes);
app.use("/teacher/classes", classRoutes);
app.use("/teacher/print", printRoutes);
app.use("/api", apiRoutes);
app.use("/api/upload", uploadRoutes);

/* 404 */
app.use((req, res) => {
  res.status(404).send("Page not found");
});

/* ERROR HANDLER */
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).send("Server error");
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`Running on port ${port}`);
});