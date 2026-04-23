import sanitizeHtml from "sanitize-html";

export function sanitizeRichText(html = "") {
  return sanitizeHtml(String(html), {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "span",
      "img"
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      span: ["class", "data-pasted"],
      img: ["src", "alt", "width", "height", "style"]
    },
    allowedClasses: {
      span: ["pasted-content"]
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer"
      })
    },
    disallowedTagsMode: "discard"
  });
}