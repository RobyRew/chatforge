import { Fragment, type ReactNode } from 'react';
import { segmentRichText } from '@chatforge/core/richtext';
import type { RichText as RichTextValue } from '@chatforge/types';

/** Renders canonical rich-text entities to React (reuses the engine's segmentation). */
export function RichText({ value }: { value?: RichTextValue }) {
  if (!value) return null;
  return (
    <>
      {segmentRichText(value).map((seg, i) => {
        let node: ReactNode = seg.text;
        for (const t of seg.types) {
          if (t === 'bold') node = <strong>{node}</strong>;
          else if (t === 'italic') node = <em>{node}</em>;
          else if (t === 'underline') node = <u>{node}</u>;
          else if (t === 'strikethrough') node = <s>{node}</s>;
          else if (t === 'code' || t === 'pre') node = <code className="rounded bg-black/30 px-1">{node}</code>;
          else if (t === 'spoiler') node = <span className="rounded bg-zinc-500/70 transition hover:bg-transparent">{node}</span>;
          else if (t === 'link') {
            node = (
              <a href={seg.url ?? '#'} target="_blank" rel="noreferrer" className="text-sky-400 underline">
                {node}
              </a>
            );
          }
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}
