import { parseRustMarkup } from "@rusttools/shared";

/** Render a string containing Rust/Unity color markup with the colors applied. */
export function RustText({ children }: { children: string | null | undefined }) {
  const segments = parseRustMarkup(children ?? "");
  return (
    <>
      {segments.map((segment, index) =>
        segment.color ? (
          <span key={index} style={{ color: segment.color }}>
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
