const editorTextarea = document.getElementById("editor");
const saveStatus = document.getElementById("save-status");
const wordCountEl = document.getElementById("word-count");
const sessionTimeEl = document.getElementById("session-time");
const submitBtn = document.getElementById("submit-btn");
const saveBtn = document.getElementById("save-btn");
const declareBtn = document.getElementById("declare-btn");
const referenceBtn = document.getElementById("reference-btn");
const darkModeBtn = document.getElementById("dark-mode-btn");

const modal = document.getElementById("declaration-modal");
const form = document.getElementById("declaration-form");
const declarationType = document.getElementById("declaration-type");
const aiFields = document.getElementById("ai-fields");
const toolName = document.getElementById("tool-name");
const promptText = document.getElementById("prompt-text");
const studentExplanation = document.getElementById("student-explanation");
const pastedPreview = document.getElementById("pasted-preview");
const generateReferenceBtn = document.getElementById("generate-reference-btn");

const { submissionId, initialContent, requireDeclaration } = window.APP_DATA || {};

let sessionId = null;
let activeSeconds = 0;
let idleSeconds = 0;
let lastActivityAt = Date.now();
let sessionStartedAt = Date.now();
let saveTimer = null;
let pendingPaste = "";
let tinyEditor = null;
let savedSelectionBookmark = null;

function htmlToPlainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return (div.textContent || div.innerText || "").replace(/\u00a0/g, " ").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function countWordsFromHtml(html) {
  const text = htmlToPlainText(html);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function getEditorContent() {
  return tinyEditor ? tinyEditor.getContent() : editorTextarea?.value || "";
}

function getEditorText() {
  return tinyEditor ? tinyEditor.getContent({ format: "text" }) : editorTextarea?.value || "";
}

function updateWordCount() {
  if (wordCountEl) wordCountEl.textContent = countWordsFromHtml(getEditorContent());
}

function setSaveStatus(text) {
  if (saveStatus) saveStatus.textContent = text;
}

function formatSeconds(total) {
  const mins = String(Math.floor(total / 60)).padStart(2, "0");
  const secs = String(total % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function getValue(id) {
  return document.getElementById(id)?.value || "";
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return data;
}

async function startSession() {
  if (!submissionId) {
    setSaveStatus("Missing submission ID");
    return;
  }

  const deviceInfo = navigator.userAgent;
  const result = await postJSON("/api/session/start", { submissionId, deviceInfo });
  sessionId = result.sessionId;
  setSaveStatus("Session started");
}

async function endSession() {
  if (!sessionId) return;

  const payload = JSON.stringify({ sessionId, activeSeconds, idleSeconds });
  navigator.sendBeacon(
    "/api/session/end",
    new Blob([payload], { type: "application/json" })
  );
}

async function logEvent(eventType, eventMeta = {}) {
  if (!sessionId) return;

  await postJSON("/api/event", {
    submissionId,
    sessionId,
    eventType,
    eventMeta
  });
}

async function autosave() {
  if (!sessionId || !tinyEditor) return;

  setSaveStatus("Saving...");

  const content = getEditorContent();
  const wordCount = countWordsFromHtml(content);

  localStorage.setItem(`draft_${submissionId}`, content);

  await postJSON("/api/draft/autosave", {
    submissionId,
    sessionId,
    content,
    wordCount
  });

  await logEvent("autosave", {
    wordCount,
    length: htmlToPlainText(content).length,
    richText: true
  });

  setSaveStatus(`Saved at ${new Date().toLocaleTimeString()}`);
}

function debounceSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => autosave().catch(console.error), 1500);
}

function updateDeclarationUI() {
  const type = declarationType?.value || "";
  const title = document.getElementById("declaration-title");
  const help = document.getElementById("declaration-help");
  const isAi = type === "ai_generated" || type === "ai_modified";

  if (aiFields) aiFields.classList.toggle("hidden", !isAi);

  if (!title || !help) return;

  if (type === "internal_move") {
    title.textContent = "Internal Move Declaration";
    help.textContent = "This looks like text moved or copied within your own document. Explain why you moved it.";
  } else if (type === "pasted_research") {
    title.textContent = "External Paste Declaration";
    help.textContent = "Explain where this pasted content came from and how you used it.";
  } else if (type === "ai_generated" || type === "ai_modified") {
    title.textContent = "AI Assistance Declaration";
    help.textContent = "Explain what AI tool you used and what it helped with.";
  } else {
    title.textContent = "Manual Declaration";
    help.textContent = "Record anything important about how you created this work.";
  }
}

function clearReferenceFields() {
  setValue("source-type", "");
  setValue("source-author", "");
  setValue("source-year", "");
  setValue("source-title", "");
  setValue("source-publisher", "");
  setValue("source-url", "");
  setValue("accessed-date", "");
  setValue("in-text-citation", "");
  setValue("bibliography-entry", "");
}

function classForDeclaration(type) {
  if (type === "internal_move") return "internal-move-content";
  if (type === "ai_modified") return "ai-modified-content";
  if (type === "ai_generated") return "ai-generated-content";
  if (type === "pasted_research") return "pasted-content";
  return "declared-content";
}

function labelForDeclaration(type) {
  if (type === "internal_move") return "Internal paste / own document";
  if (type === "ai_modified") return "AI modified";
  if (type === "ai_generated") return "AI generated";
  if (type === "pasted_research") return "External source / pasted research";
  return "Declared material";
}

function rememberSelection() {
  if (!tinyEditor) return;

  try {
    savedSelectionBookmark = tinyEditor.selection.getBookmark(2, true);
  } catch {
    savedSelectionBookmark = null;
  }
}

function restoreRememberedSelection(collapseToEnd = false) {
  if (!tinyEditor || !savedSelectionBookmark) return false;

  try {
    tinyEditor.focus();
    tinyEditor.selection.moveToBookmark(savedSelectionBookmark);
    if (collapseToEnd) tinyEditor.selection.collapse(false);
    return true;
  } catch {
    return false;
  }
}

function applyDeclarationHighlight(type) {
  if (!tinyEditor) return;

  restoreRememberedSelection(false);

  const selectedHtml = tinyEditor.selection.getContent({ format: "html" }) || "";
  const selectedText = tinyEditor.selection.getContent({ format: "text" }) || "";

  if (!selectedText.trim()) {
    savedSelectionBookmark = null;
    return;
  }

  const cssClass = classForDeclaration(type);
  const label = labelForDeclaration(type);

  tinyEditor.selection.setContent(
    `<span class="${cssClass}" data-declaration-type="${escapeHtml(type)}" title="${escapeHtml(label)}">${selectedHtml}</span>`
  );

  savedSelectionBookmark = null;
  updateWordCount();
  debounceSave();
}

function insertInTextCitation(citation) {
  if (!tinyEditor || !citation) return;

  restoreRememberedSelection(true);
  tinyEditor.focus();

  tinyEditor.insertContent(
    ` <span class="citation-marker" data-citation="true" title="In-text citation">${escapeHtml(citation)}</span>`
  );

  updateWordCount();
  debounceSave();
}

function addBibliographyEntry(entry) {
  if (!tinyEditor || !entry) return;

  const content = tinyEditor.getContent() || "";
  const escapedEntry = escapeHtml(entry);

  if (content.includes(escapedEntry)) return;

  let updated = content;

  if (!updated.includes('data-references-section="true"')) {
    updated += `
      <div class="references-section" data-references-section="true">
        <h2>References</h2>
        <ul class="references-list">
        </ul>
      </div>`;
  }

  updated = updated.replace(
    /<ul class="references-list">([\s\S]*?)<\/ul>/,
    `<ul class="references-list">$1<li class="bibliography-entry" data-bibliography-entry="true">${escapedEntry}</li></ul>`
  );

  tinyEditor.setContent(updated);
  updateWordCount();
  debounceSave();
}

function openDeclaration(data = {}) {
  if (!modal) {
    alert("Declaration form is missing from the page.");
    return;
  }

  const excerpt = data.originalTextExcerpt || data.text || "";
  pendingPaste = excerpt;

  if (declarationType) declarationType.value = data.type || "manual_declaration";
  if (toolName) toolName.value = data.toolName || "";
  if (promptText) promptText.value = data.promptText || "";
  if (studentExplanation) studentExplanation.value = data.explain || "";
  if (pastedPreview) pastedPreview.value = excerpt.slice(0, 500);

  clearReferenceFields();

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  updateDeclarationUI();
}

function closeDeclaration() {
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}

async function saveDeclaration() {
  if (!sessionId) {
    alert("Session is still loading. Please wait a moment and try again.");
    return;
  }

  const payload = {
    submissionId,
    sessionId,
    declarationType: declarationType?.value || "manual_declaration",
    toolName: toolName?.value || "",
    promptText: promptText?.value || "",
    originalTextExcerpt: (pastedPreview?.value || pendingPaste || "").slice(0, 500),
    studentExplanation: studentExplanation?.value || "",

    citationStyle: getValue("citation-style") || "apa7",
    sourceType: getValue("source-type"),
    sourceAuthor: getValue("source-author"),
    sourceYear: getValue("source-year"),
    sourceTitle: getValue("source-title"),
    sourcePublisher: getValue("source-publisher"),
    sourceUrl: getValue("source-url"),
    accessedDate: getValue("accessed-date"),
    inTextCitation: getValue("in-text-citation"),
    bibliographyEntry: getValue("bibliography-entry")
  };

  applyDeclarationHighlight(payload.declarationType);

  const result = await postJSON("/api/declaration", payload);

  if (result.ok) {
    closeDeclaration();
    setSaveStatus("Declaration saved");
    await autosave();
  }
}

async function generateReference() {
  try {
    const result = await postJSON("/api/reference/generate", {
      citationStyle: getValue("citation-style") || "apa7",
      sourceType: getValue("source-type"),
      sourceAuthor: getValue("source-author"),
      sourceYear: getValue("source-year"),
      sourceTitle: getValue("source-title"),
      sourcePublisher: getValue("source-publisher"),
      sourceUrl: getValue("source-url"),
      accessedDate: getValue("accessed-date"),
      excerpt: getValue("pasted-preview")
    });

    const inTextCitation = result.inTextCitation || "";
    const bibliographyEntry = result.bibliographyEntry || "";

    setValue("in-text-citation", inTextCitation);
    setValue("bibliography-entry", bibliographyEntry);

    insertInTextCitation(inTextCitation);
    addBibliographyEntry(bibliographyEntry);

    await logEvent("reference_generated", {
      citationStyle: getValue("citation-style") || "apa7",
      sourceType: getValue("source-type"),
      inTextCitation,
      hasBibliographyEntry: Boolean(bibliographyEntry)
    }).catch(console.error);

    setSaveStatus("Reference generated and added to document");
    await autosave();
  } catch (err) {
    console.error(err);
    alert(err.message || "Reference generation failed");
  }
}

async function submitWork() {
  const confirmed = window.confirm(
    "I confirm this submission accurately reflects how I produced this work."
  );

  if (!confirmed) return;

  await autosave();

  const finalText = getEditorContent();

  await postJSON("/api/submit", {
    submissionId,
    finalText
  });

  await logEvent("submit", {
    finalWordCount: countWordsFromHtml(finalText),
    richText: true
  });

  alert("Submission saved");
  window.location.href = "/student/dashboard";
}

function applyDarkMode(enabled) {
  document.body.classList.toggle("dark-mode", enabled);
  localStorage.setItem("studentEvidenceDarkMode", enabled ? "1" : "0");

  if (tinyEditor) {
    tinyEditor.getBody().style.background = enabled ? "#111827" : "#ffffff";
    tinyEditor.getBody().style.color = enabled ? "#f9fafb" : "#111827";
  }
}

async function initEditor() {
  const cachedContent = localStorage.getItem(`draft_${submissionId}`) || initialContent || "";
  if (editorTextarea) editorTextarea.value = cachedContent;

  await tinymce.init({
    selector: "#editor",
    license_key: "gpl",
    menubar: false,
    branding: false,
    browser_spellcheck: true,
    contextmenu: false,
    height: 560,
    plugins: "lists link image table code wordcount autoresize",
    toolbar: "undo redo | blocks fontfamily fontsize | bold italic underline | alignleft aligncenter alignright | bullist numlist | outdent indent | image table | code",
    font_size_formats: "10pt 11pt 12pt 14pt 16pt 18pt 20pt 24pt 28pt 32pt",
    paste_as_text: true,
    content_style: `
      body { font-family: Arial, sans-serif; font-size: 16px; line-height: 1.5; }
      .pasted-content { background: #fff3b0; border-bottom: 2px solid #f59e0b; padding: 0 2px; }
      .internal-move-content { background: #dbeafe; border-bottom: 2px solid #2563eb; padding: 0 2px; }
      .ai-modified-content { background: #fee2e2; border-bottom: 2px solid #dc2626; padding: 0 2px; }
      .ai-generated-content { background: #fce7f3; border-bottom: 2px solid #db2777; padding: 0 2px; }
      .declared-content { background: #e5e7eb; border-bottom: 2px solid #6b7280; padding: 0 2px; }
      .citation-marker { background: #dcfce7; border: 1px solid #16a34a; border-radius: 4px; padding: 0 3px; font-weight: 600; }
      .references-section { margin-top: 2rem; border-top: 2px solid #16a34a; padding-top: 0.75rem; }
      .references-list { padding-left: 1.5rem; }
      .bibliography-entry { background: #f0fdf4; border-left: 4px solid #16a34a; padding: 0.35rem 0.5rem; margin: 0.35rem 0; }
      img { max-width: 100%; height: auto; }
    `,
    setup: (editor) => {
      tinyEditor = editor;

      editor.on("init", async () => {
        editor.setContent(cachedContent || "");
        updateWordCount();
        applyDarkMode(localStorage.getItem("studentEvidenceDarkMode") === "1");
        await startSession();
      });

      editor.on("input keyup change undo redo setcontent", () => {
        lastActivityAt = Date.now();
        updateWordCount();
        debounceSave();
      });

      editor.on("paste", async (event) => {
        lastActivityAt = Date.now();
        event.preventDefault();

        const pastedText = event.clipboardData?.getData("text/plain") || "";
        const currentText = getEditorText();
        const likelyInternalMove = pastedText.length > 20 && currentText.includes(pastedText);
        const spanClass = likelyInternalMove ? "internal-move-content" : "pasted-content";

        const html = `<span class="${spanClass}" data-pasted="true">${escapeHtml(pastedText).replace(/\n/g, "<br>")}</span>`;
        editor.insertContent(html);

        await logEvent(likelyInternalMove ? "internal_paste" : "external_paste", {
          pastedLength: pastedText.length,
          pastedPreview: pastedText.slice(0, 200),
          richText: true
        });

        if (requireDeclaration || !likelyInternalMove) {
          openDeclaration({
            type: likelyInternalMove ? "internal_move" : "pasted_research",
            toolName: likelyInternalMove ? "Own document" : "",
            originalTextExcerpt: pastedText.slice(0, 500)
          });
        }

        updateWordCount();
        debounceSave();
      });

      editor.on("cut", async () => {
        const selected = editor.selection.getContent({ format: "text" }) || "";
        await logEvent("cut", {
          selectedLength: selected.length,
          selectedPreview: selected.slice(0, 120)
        });
      });

      editor.on("copy", async () => {
        const selected = editor.selection.getContent({ format: "text" }) || "";
        await logEvent("copy", {
          selectedLength: selected.length,
          selectedPreview: selected.slice(0, 120)
        });
      });

      editor.on("drop", async () => {
        await logEvent("move_or_drop", {
          note: "Text, image, or content may have been moved/dropped in the document."
        });
      });
    }
  });
}

saveBtn?.addEventListener("click", () => autosave().catch((err) => {
  console.error(err);
  alert(err.message || "Save failed");
}));

submitBtn?.addEventListener("click", () => submitWork().catch((err) => {
  console.error(err);
  alert(err.message || "Submit failed");
}));

declareBtn?.addEventListener("click", () => {
  rememberSelection();
  openDeclaration({ type: "manual_declaration", originalTextExcerpt: "" });
});

referenceBtn?.addEventListener("click", async () => {
  rememberSelection();
  const selectedText = tinyEditor?.selection.getContent({ format: "text" }) || "";

  openDeclaration({
    type: "pasted_research",
    originalTextExcerpt: selectedText,
    explain: selectedText ? "I used this selected material as a source." : "I am recording a source used for this work."
  });

  await logEvent("reference_opened", {
    selectedLength: selectedText.length,
    selectedPreview: selectedText.slice(0, 200)
  }).catch(console.error);
});

generateReferenceBtn?.addEventListener("click", generateReference);

declarationType?.addEventListener("change", updateDeclarationUI);

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveDeclaration();
  } catch (err) {
    console.error(err);
    alert(err.message || "Declaration save failed");
  }
});

document.getElementById("cancel-declaration-btn")?.addEventListener("click", closeDeclaration);

darkModeBtn?.addEventListener("click", () => {
  const enabled = !document.body.classList.contains("dark-mode");
  applyDarkMode(enabled);
});

setInterval(() => {
  const now = Date.now();
  const inactiveFor = now - lastActivityAt;

  if (inactiveFor < 60000) activeSeconds += 1;
  else idleSeconds += 1;

  if (sessionTimeEl) {
    sessionTimeEl.textContent = formatSeconds(Math.floor((now - sessionStartedAt) / 1000));
  }
}, 1000);

setInterval(() => {
  autosave().catch(console.error);
}, 30000);

window.addEventListener("beforeunload", endSession);

initEditor().catch((err) => {
  console.error(err);
  setSaveStatus("Editor failed to load");
});
