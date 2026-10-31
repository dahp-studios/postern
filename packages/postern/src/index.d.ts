export type ItemType = "password" | "text" | "url" | "file";

export type Item =
  | { type: "password" | "text" | "url"; text: string }
  | { type: "file"; name: string; mime: string; bytes: Uint8Array };

export interface Received {
  item: Item;
  /** The 4-digit confirmation code. Ask the user to check it matches the phone before using the item. */
  code: string;
}

export type Status = "connecting" | "waiting" | "offline";

export interface ReceiveOptions {
  /** Relay address. Default https://postern.dahp.io, or your self-hosted relay. */
  server?: string;
  /** What the phone may send. Default: all four types. */
  types?: ItemType[];
  /** Default "auto": WebSocket where available, plain HTTP long polling otherwise. */
  transport?: "auto" | "websocket" | "poll";
  onStatus?: (status: Status) => void;
  /** Aborting cancels the session. */
  signal?: AbortSignal;
}

export interface Session {
  /** Show this as a QR code. The one-time public key is after "#", which browsers never send to servers. */
  link: string;
  sessionId: string;
  /** Milliseconds since the epoch. Sessions last 2 minutes. */
  expiresAt: number;
  /** Resolves when the phone sends; rejects with a PosternError. */
  result: Promise<Received>;
  cancel(): void;
  /** Offline mode: the text of the phone's QR code ("PT1.…"), read with your own scanner. */
  acceptOffline(text: string): Promise<Received>;
}

export class PosternError extends Error {
  code: "expired" | "cancelled" | "decrypt_failed" | "wrong_session";
}

export const DEFAULT_SERVER: string;
export const ITEM_TYPES: ItemType[];
export const LIMITS: { password: number; text: number; url: number; fileBytes: number; fileName: number };

/** Start a session and wait for the phone. */
export function receive(options?: ReceiveOptions): Promise<Session>;

/** Draw a QR code for `text` on a canvas (default 640 px). */
export function drawQr(canvas: HTMLCanvasElement, text: string, size?: number): void;

/** Put a value into an input or textarea the way typing would, so frameworks see the change. */
export function fill(field: HTMLInputElement | HTMLTextAreaElement, value: string): void;

/** The UTF-8 text of a text-like file (JSON, plain text, CSV…), or null. */
export function fileAsText(item: Item): string | null;

/** True for http(s) links only. */
export function isSafeUrl(text: string): boolean;
