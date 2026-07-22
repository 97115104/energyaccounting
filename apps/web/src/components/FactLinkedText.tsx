import { factSegments, type FactLink } from "../lib/greeting";

type Props = {
  text: string;
  links?: FactLink[];
};

/** Renders fact copy with only the verify phrases linked (new tab). */
export function FactLinkedText({ text, links = [] }: Props) {
  return (
    <>
      {factSegments(text, links).map((seg, i) =>
        seg.url ? (
          <a
            key={`${i}-${seg.text}`}
            className="fact-inline-link"
            href={seg.url}
            target="_blank"
            rel="noreferrer"
          >
            {seg.text}
          </a>
        ) : (
          <span key={`${i}-${seg.text}`}>{seg.text}</span>
        ),
      )}
    </>
  );
}
