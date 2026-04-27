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

/* PATH SETUP */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/* VIEW ENGINE (MUST COME BEFORE ROUTES) */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* BODY PARSING (FIXES YOUR ERROR + LARGE PAYLOADS) */
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));

/* COOKIES (FIXES LOGIN ERROR) */
app.use(cookieParser(process.env.APP_SECRET || "dev-secret"));

/* STATIC FILES */
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/tinymce", express.static(path.join(__dirname, "node_modules", "tinymce")));
app.use("/uploads", express.static(uploadsDir));

/* ROUTES */
app.get("/", (req, res) => {
  res.redirect("/login");
});

app.use("/", authRoutes);
app.use("/student", studentRoutes);
app.use("/teacher", teacherRoutes);
app.use("/teacher/assignments", assignmentRoutes);
app.use("/teacher/classes", classRoutes);
app.use("/teacher/print", printRoutes);
app.use("/api", apiRoutes);
app.use("/api/upload", uploadRoutes);

/* HEALTH */
app.get("/health", (req, res) => {
  res.send("ok");
});

/* 404 */
app.use((req, res) => {
  res.status(404).send("Page not found");
});

/* ERROR HANDLER */
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).send("Server error");
});

/* START SERVER */
const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`Running on port ${port}`);
});