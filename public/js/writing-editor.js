const editorTextarea = document.getElementById("editor");
const saveStatus = document.getElementById("save-status");
const wordCountEl = document.getElementById("word-count");
const sessionTimeEl = document.getElementById("session-time");
const submitBtn = document.getElementById("submit-btn");
const overlay = document.getElementById("declaration-overlay");
const modal = document.getElementById("declaration-modal");
const form = document.getElementById("declaration-form");
const declarationType = document.getElementById("declaration-type");
const aiFields = document.getElementById("ai-fields");
const toolName = document.getElementById("tool-name");
const promptText = document.getElementById("prompt-text");
const studentExplanation = document.getElementById("student-explanation");
const pastedPreview = document.getElementById("pasted-preview");

const { submissionId, initialContent, requireDeclaration } = window.APP_DATA;

let sessionId = null;
let activeSeconds = 0;
let idleSeconds = 0;
let lastActivityAt = Date.now();
let sessionStartedAt = Date.now();
let pendingPaste = "";
let tinyEditor = null;

function htmlToPlainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return (div.textContent || div.innerText || "").replace(/ /g, " ").trim();
}

function countWordsFromHtml(html) {
  const text = htmlToPlainText(html);
  return text ? text.split(/\s+/).length : 0;
}

function getEditorContent() {
  return tinyEditor ? tinyEditor.getContent() : editorTextarea.value;
}

function updateWordCount() {
  wordCountEl.textContent = countWordsFromHtml(getEditorContent());
}

function setSaveStatus(text) {
  saveStatus.textContent = text;
}

function formatSeconds(total) {
  const mins = String(Math.floor(total / 60)).padStart(2, "0");
  const secs = String(total % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function startSession() {
  const deviceInfo = navigator.userAgent;
  const result = await postJSON("/api/session/start", { submissionId, deviceInfo });
  sessionId = result.sessionId;
  setSaveStatus("Session started");
}

async function autosave() {
  if (!sessionId || !tinyEditor) return;
  setSaveStatus("Saving...");
  const content = getEditorContent();
  const wordCount = countWordsFromHtml(content);

  localStorage.setItem(`draft_${submissionId}`, content);

  await postJSON("/api/draft/autosave", { submissionId, sessionId, content, wordCount });
  await postJSON("/api/event", {
    submissionId,
    sessionId,
    eventType: "autosave",
    eventMeta: { wordCount, length: htmlToPlainText(content).length, richText: true }
  });
  setSaveStatus(`Saved at ${new Date().toLocaleTimeString()}`);
}

async function logEvent(eventType, eventMeta = {}) {
  if (!sessionId) return;
  await postJSON("/api/event", { submissionId, sessionId, eventType, eventMeta });
}

function openModal(text) {
  pendingPaste = text;
  pastedPreview.value = text.slice(0, 500);
  declarationType.value = "";
  toolName.value = "";
  promptText.value = "";
  studentExplanation.value = "";
  aiFields.classList.add("hidden");
  overlay.classList.remove("hidden");
  modal.classList.remove("hidden");
}

function closeModal() {
  overlay.classList.add("hidden");
  modal.classList.add("hidden");
}

declarationType.addEventListener("change", () => {
  const ai = declarationType.value === "ai_generated" || declarationType.value === "ai_modified";
  aiFields.classList.toggle("hidden", !ai);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await postJSON("/api/declaration", {
    submissionId,
    sessionId,
    declarationType: declarationType.value,
    toolName: toolName.value,
    promptText: promptText.value,
    originalTextExcerpt: pendingPaste.slice(0, 500),
    studentExplanation: studentExplanation.value
  });
  closeModal();
});

submitBtn.addEventListener("click", async () => {
  const confirmed = window.confirm("I confirm this submission accurately reflects how I produced this work.");
  if (!confirmed) return;
  await autosave();
  const finalText = getEditorContent();
  await postJSON("/api/submit", { submissionId, finalText });
  await logEvent("submit", { finalWordCount: countWordsFromHtml(finalText), richText: true });
  alert("Submission saved");
  window.location.href = "/student/dashboard";
});

setInterval(() => {
  const now = Date.now();
  const inactiveFor = now - lastActivityAt;
  if (inactiveFor < 60000) activeSeconds += 1;
  else idleSeconds += 1;
  sessionTimeEl.textContent = formatSeconds(Math.floor((now - sessionStartedAt) / 1000));
}, 1000);

setInterval(() => {
  autosave().catch(console.error);
}, 30000);

window.addEventListener("beforeunload", async () => {
  if (!sessionId) return;
  navigator.sendBeacon("/api/session/end", new Blob([
    JSON.stringify({ sessionId, activeSeconds, idleSeconds })
  ], { type: "application/json" }));
});

async function initEditor() {
  const cachedContent = localStorage.getItem(`draft_${submissionId}`) || initialContent || "";
  editorTextarea.value = cachedContent;

  await tinymce.init({
    selector: "#editor",
    menubar: false,
    branding: false,
    height: 520,
    plugins: "lists link paste help wordcount autoresize",
    toolbar: "undo redo | blocks | fontfamily fontsize | bold italic underline | bullist numlist | indent outdent | removeformat | help",
    font_family_formats: "Arial=arial,helvetica,sans-serif; Times New Roman=times new roman,times,serif; Georgia=georgia,palatino,serif; Verdana=verdana,geneva,sans-serif; Courier New=courier new,courier,monospace",
    font_size_formats: "10pt 12pt 14pt 16pt 18pt 24pt 36pt",
    paste_as_text: true,
    content_style: "body { font-family: Arial, sans-serif; font-size: 14pt; line-height: 1.5; margin: 1rem; }",
    setup: (editor) => {
      tinyEditor = editor;

      editor.on("init", async () => {
        editor.setContent(cachedContent || "");
        updateWordCount();
        await startSession();
      });

      editor.on("input keyup change undo redo setcontent", () => {
        lastActivityAt = Date.now();
        updateWordCount();
      });

      editor.on("paste", async (event) => {
        lastActivityAt = Date.now();
        const pastedText = event.clipboardData?.getData("text") || "";
        await logEvent("paste", {
          pastedLength: pastedText.length,
          pastedPreview: pastedText.slice(0, 200),
          richText: true
        });
        if (requireDeclaration) openModal(pastedText);
      });
    }
  });
}

initEditor().catch((err) => {
  console.error(err);
  setSaveStatus("Editor failed to load");
});
