const appData = window.APP_DATA || {};
const submissionId = appData.submissionId;
const initialContent = appData.initialContent || "";

let editor = null;
let activePastedText = "";

/* ------------------ HELPERS ------------------ */

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getValue(id) {
  return document.getElementById(id)?.value || "";
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

/* ------------------ MODAL ------------------ */

function openDeclarationModal(text = "") {
  activePastedText = text;

  setValue("pastedText", text);
  setValue("declarationExplanation", "");

  const modal = document.getElementById("declarationModal");
  if (modal) modal.style.display = "flex";
}

function closeDeclarationModal() {
  const modal = document.getElementById("declarationModal");
  if (modal) modal.style.display = "none";
}

/* ------------------ API ------------------ */

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* ------------------ SAVE ------------------ */

async function save() {
  if (!editor) return;

  const content = editor.getContent();
  const text = editor.getContent({ format: "text" });
  const wordCount = text.trim() ? text.split(/\s+/).length : 0;

  await postJSON("/api/draft/autosave", {
    submissionId,
    content,
    wordCount
  });

  alert("Saved");
}

/* ------------------ SUBMIT ------------------ */

async function submit() {
  await save();

  await postJSON("/api/submit", {
    submissionId,
    finalText: editor.getContent()
  });

  alert("Submitted");
  window.location.href = "/student/dashboard";
}

/* ------------------ REFERENCES ------------------ */

function addBibliographyEntry(entry) {
  if (!entry || !editor) return;

  let content = editor.getContent();

  if (!content.includes('data-references-section="true"')) {
    content += `
      <div class="references-section" data-references-section="true">
        <h2>References / Bibliography</h2>
        <ol class="references-list"></ol>
      </div>
    `;
  }

  content = content.replace(
    /<ol class="references-list">([\s\S]*?)<\/ol>/,
    `<ol class="references-list">$1<li class="bibliography-entry">${escapeHtml(entry)}</li></ol>`
  );

  editor.setContent(content);
}

/* ------------------ DECLARATION SAVE ------------------ */

async function saveDeclaration() {
  const explanation = getValue("declarationExplanation");

  if (!explanation.trim()) {
    alert("Please explain how you used this material");
    return;
  }

  const payload = {
    submissionId,
    pastedText: getValue("pastedText") || activePastedText,
    declarationType: getValue("declarationType"),
    studentExplanation: explanation,
    citationStyle: "apa7",
    sourceType: getValue("sourceType"),
    sourceAuthor: getValue("sourceAuthor"),
    sourceYear: getValue("sourceYear"),
    sourceTitle: getValue("sourceTitle"),
    sourcePublisher: getValue("sourcePublisher"),
    sourceUrl: getValue("sourceUrl"),
    accessedDate: getValue("accessedDate")
  };

  const result = await postJSON("/api/declarations", payload);

  /* Insert citation */
  if (result.inTextCitation) {
    editor.insertContent(
      ` <sup class="citation-marker">${escapeHtml(result.inTextCitation)}</sup>`
    );
  }

  /* Add bibliography */
  if (result.bibliographyEntry) {
    addBibliographyEntry(result.bibliographyEntry);
  }

  await save();

  closeDeclarationModal();
  alert("Declaration saved");
}

/* ------------------ BUTTONS ------------------ */

function initButtons() {
  document.getElementById("saveBtn")?.addEventListener("click", () => {
    save().catch(err => alert(err.message));
  });

  document.getElementById("submitBtn")?.addEventListener("click", () => {
    submit().catch(err => alert(err.message));
  });

  document.getElementById("declareBtn")?.addEventListener("click", () => {
    const text = editor.selection.getContent({ format: "text" }) || "";
    openDeclarationModal(text);
  });

  document.getElementById("referenceBtn")?.addEventListener("click", () => {
    const text = editor.selection.getContent({ format: "text" }) || "";
    openDeclarationModal(text);
  });

  document.getElementById("cancelDeclarationBtn")?.addEventListener("click", closeDeclarationModal);
  document.getElementById("saveDeclarationBtn")?.addEventListener("click", () => {
    saveDeclaration().catch(err => alert(err.message));
  });
}

/* ------------------ INIT EDITOR ------------------ */

document.addEventListener("DOMContentLoaded", () => {
  initButtons();

  tinymce.init({
    selector: "#editor",
    height: 650,
    menubar: "edit insert format table tools",
    branding: false,
    plugins: "lists link image table code wordcount advlist autolink charmap preview searchreplace fullscreen media",
    toolbar: [
      "undo redo | blocks fontfamily fontsize",
      "bold italic underline strikethrough | forecolor backcolor",
      "alignleft aligncenter alignright alignjustify",
      "bullist numlist | outdent indent",
      "link image media table",
      "removeformat | preview fullscreen code"
    ],
    paste_as_text: false,
    automatic_uploads: true,
    file_picker_types: "image",

    file_picker_callback: (cb) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";

      input.onchange = () => {
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = () => cb(reader.result, { alt: file.name });
        reader.readAsDataURL(file);
      };

      input.click();
    },

    content_style: `
      body { font-family: Arial; font-size: 16px; line-height: 1.6; }

      .pasted-content {
        background: #fff3b0;
        border-bottom: 2px solid #f59e0b;
      }

      .citation-marker {
        background: #dcfce7;
        border: 1px solid #16a34a;
        padding: 0 3px;
        font-weight: bold;
      }

      .references-section {
        margin-top: 2rem;
        border-top: 2px solid #16a34a;
      }

      .bibliography-entry {
        background: #f0fdf4;
        border-left: 4px solid #16a34a;
        padding: 4px;
        margin: 4px 0;
      }
    `,

    setup: (ed) => {
      editor = ed;

      ed.on("init", () => {
        editor.setContent(initialContent);
      });

      ed.on("paste", (e) => {
        e.preventDefault();

        const text = e.clipboardData.getData("text/plain");
        if (!text.trim()) return;

        const html = `<span class="pasted-content">${escapeHtml(text)}</span>`;

        editor.insertContent(html);
        openDeclarationModal(text);
      });
    }
  });
});