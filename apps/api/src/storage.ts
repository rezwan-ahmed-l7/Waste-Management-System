import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { env } from "./config.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string,string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf"
};
const DECLARED_MIME_TYPES = new Set(Object.keys(MIME_EXTENSIONS));
const STORAGE_KEY_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/i;

export class UnsupportedUploadError extends Error {
  constructor() {
    super("Only JPEG, PNG, WebP images and PDF documents are accepted.");
    this.name = "UnsupportedUploadError";
  }
}

export const privateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 5, fields: 12, fieldSize: 8 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (!DECLARED_MIME_TYPES.has(file.mimetype)) {
      callback(new UnsupportedUploadError());
      return;
    }
    callback(null, true);
  }
});

function storageRoot() {
  return resolve(process.cwd(), env.PRIVATE_STORAGE_DIR);
}

function safeOriginalName(name: string) {
  const cleaned = basename(name).split("").filter(character => {
    const code = character.charCodeAt(0);
    return code >= 0x20 && code !== 0x7f;
  }).join("").trim();
  return (cleaned || "upload").slice(0, 255);
}

function remoteStorageConfigured() {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function storageObjectUrl(key: string) {
  if (!STORAGE_KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
  return env.SUPABASE_URL + "/storage/v1/object/" +
    encodeURIComponent(env.SUPABASE_STORAGE_BUCKET) + "/" + encodeURIComponent(key);
}

function storageHeaders(extra: Record<string,string> = {}) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Private evidence storage is not configured.");
  return {
    Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    ...extra
  };
}

export async function storePrivateUpload(file: Express.Multer.File) {
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected || !MIME_EXTENSIONS[detected.mime]) throw new UnsupportedUploadError();

  const extension = MIME_EXTENSIONS[detected.mime];
  const storageKey = randomUUID() + "." + extension;
  if (remoteStorageConfigured()) {
    const response = await fetch(storageObjectUrl(storageKey), {
      method: "POST",
      headers: storageHeaders({
        "Content-Type": detected.mime,
        "x-upsert": "false",
        "cache-control": "0"
      }),
      body: new Uint8Array(file.buffer)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error("Private evidence upload failed (" + response.status + "): " + detail.slice(0, 300));
    }
  } else {
    if (env.NODE_ENV === "production") throw new Error("Durable private evidence storage is required in production.");
    const root = storageRoot();
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(join(root, storageKey), file.buffer, { flag: "wx", mode: 0o600 });
  }

  return {
    storageKey,
    originalFileName: safeOriginalName(file.originalname),
    mediaType: detected.mime,
    fileSizeBytes: file.buffer.byteLength,
    checksumSha256: createHash("sha256").update(file.buffer).digest("hex")
  };
}

export async function readPrivateUpload(storageKey: string) {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) throw new Error("Invalid storage key.");
  let buffer: Buffer;
  if (remoteStorageConfigured()) {
    const response = await fetch(storageObjectUrl(storageKey), {
      headers: storageHeaders()
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error("Private evidence object not found.");
      throw new Error("Private evidence download failed (" + response.status + ").");
    }
    buffer = Buffer.from(await response.arrayBuffer());
  } else {
    if (env.NODE_ENV === "production") throw new Error("Durable private evidence storage is required in production.");
    buffer = await readFile(join(storageRoot(), storageKey));
  }
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !MIME_EXTENSIONS[detected.mime]) throw new UnsupportedUploadError();
  return { buffer, mediaType: detected.mime, extension: MIME_EXTENSIONS[detected.mime] };
}

export async function removePrivateUpload(storageKey: string) {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) return;
  if (remoteStorageConfigured()) {
    const response = await fetch(env.SUPABASE_URL + "/storage/v1/object/" + encodeURIComponent(env.SUPABASE_STORAGE_BUCKET), {
      method: "DELETE",
      headers: storageHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [storageKey] })
    });
    if (!response.ok && response.status !== 404) {
      throw new Error("Private evidence deletion failed (" + response.status + ").");
    }
    return;
  }
  if (env.NODE_ENV === "production") throw new Error("Durable private evidence storage is required in production.");
  await unlink(join(storageRoot(), storageKey)).catch(() => undefined);
}
