import { capabilities, type CapabilityMatrix } from '@chatforge/types';
import type { Exporter } from '../contracts';
import { slug } from '../format';
import { strToU8 } from '../zip';

/** Canonical JSON preserves everything (it *is* the canonical model). */
const fullCaps = Object.fromEntries(capabilities.map((c) => [c, true])) as CapabilityMatrix;

export const jsonExporter: Exporter = {
  format: 'json',
  capabilities: fullCaps,
  async serialize(conv, _ctx, opts) {
    const json = JSON.stringify(conv, null, 2);
    const title = opts?.title ?? conv.title;
    return {
      files: [{ name: 'conversation.json', bytes: strToU8(json) }],
      suggestedName: `${slug(title)}.canonical.json`,
      mime: 'application/json',
    };
  },
};
