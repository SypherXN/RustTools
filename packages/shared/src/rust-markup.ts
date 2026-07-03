/**
 * Rust names and chat can embed Unity rich-text markup (e.g.
 * `<color=#55aaff>heavy pot enjoyer</color>`, `<size=20>`, `<b>`). Parse the
 * color markup into styled segments so UIs can render the intended color
 * instead of showing the raw tags, and strip the other formatting tags.
 */
export interface RustTextSegment {
  text: string;
  color?: string;
}

const RUST_TAG_RE = /<(\/?)(color|size|b|i|material|quad)(?:=([^>]*))?>/gi;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CSS_NAMED_COLOR_RE = /^[a-zA-Z]+$/;

/** Return a CSS-safe color string, or undefined when the value isn't usable. */
function normalizeRustColor(value: string): string | undefined {
  const raw = value.trim().replace(/^["']|["']$/g, "");
  if (!raw) return undefined;
  if (HEX_COLOR_RE.test(raw)) return raw;
  if (CSS_NAMED_COLOR_RE.test(raw)) return raw.toLowerCase();
  return undefined;
}

/** Split text containing Rust/Unity markup into segments with optional colors. */
export function parseRustMarkup(input: string): RustTextSegment[] {
  if (!input) return [];

  const segments: RustTextSegment[] = [];
  const colorStack: Array<string | undefined> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushText = (text: string): void => {
    if (!text) return;
    const color = colorStack[colorStack.length - 1];
    const previous = segments[segments.length - 1];
    if (previous && previous.color === color) {
      previous.text += text;
      return;
    }
    segments.push(color ? { text, color } : { text });
  };

  RUST_TAG_RE.lastIndex = 0;
  while ((match = RUST_TAG_RE.exec(input)) !== null) {
    pushText(input.slice(lastIndex, match.index));
    lastIndex = RUST_TAG_RE.lastIndex;

    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    if (tag !== "color") continue; // size/b/i/material/quad are stripped

    if (closing) {
      colorStack.pop();
    } else {
      colorStack.push(normalizeRustColor(match[3] ?? ""));
    }
  }
  pushText(input.slice(lastIndex));

  return segments;
}

/** Remove all Rust/Unity markup tags, leaving only the plain text. */
export function stripRustMarkup(input: string): string {
  return parseRustMarkup(input)
    .map((segment) => segment.text)
    .join("");
}
