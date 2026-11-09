import { Fragment, type ReactNode } from 'react';
import { segmentRichText } from '@robyrew/chat-converter/richtext';
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
          else if (t === 'code' || t === 'pre') node = <code>{node}</code>;
          else if (t === 'spoiler') node = <mark className="cf-spoiler">{node}</mark>;
          else if (t === 'link') {
            node = (
              <a href={seg.url ?? '#'} target="_blank" rel="noreferrer">
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
