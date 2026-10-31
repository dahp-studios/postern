import type { ItemType, Received } from "./index.js";
export { fill } from "./index.js";

export type Scanner = (
  video: HTMLVideoElement,
  onText: (text: string) => Promise<boolean>,
  options?: { facingMode?: "user" | "environment" },
) => Promise<() => void>;

export interface OpenOptions {
  server?: string;
  types?: ItemType[];
  /** Dialog title. Default "Send from your phone". */
  title?: string;
  /** Pass `startScanner` from "@dahp/postern/scanner" to offer offline mode. */
  scanner?: Scanner;
}

/** Show the dialog. Resolves with what the user confirmed, or null if they closed it. */
export function open(options?: OpenOptions): Promise<Received | null>;

export interface AttachOptions extends Omit<OpenOptions, "title"> {
  /** Button text. Default "From phone". */
  label?: string;
}

/** Add a "From phone" button after a field. Returns a function that removes it. */
export function attach(field: HTMLInputElement | HTMLTextAreaElement, options?: AttachOptions): () => void;

/** Add a button to every input or textarea marked with data-postern. */
export function attachAll(root?: ParentNode, options?: AttachOptions): Array<() => void>;

/**
 * <postern-button for="field-id" server="…" types="password,text" label="From phone">
 * Fires a cancelable "postern-receive" event (detail: Received); unless prevented, fills the field.
 */
export class PosternButton extends HTMLElement {
  readonly field: HTMLInputElement | HTMLTextAreaElement | null;
  scanner?: Scanner;
  receive(): Promise<void>;
}

declare global {
  interface HTMLElementTagNameMap {
    "postern-button": PosternButton;
  }
  interface HTMLElementEventMap {
    "postern-receive": CustomEvent<Received>;
  }
}
