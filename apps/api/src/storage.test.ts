import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readPrivateUpload,
  removePrivateUpload,
  storePrivateUpload,
  UnsupportedUploadError
} from "./storage.js";

const originalCwd = process.cwd();
let temporaryDirectory = "";

afterEach(async () => {
  process.chdir(originalCwd);
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = "";
});

describe("private upload storage", () => {
  it("stores, inspects, reads and removes a real PNG using a generated storage key", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "waste-storage-"));
    process.chdir(temporaryDirectory);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2cAAAAASUVORK5CYII=",
      "base64"
    );
    const stored = await storePrivateUpload({
      buffer: png,
      originalname: "../../unsafe.png",
      size: png.byteLength
    } as Express.Multer.File);

    expect(stored.mediaType).toBe("image/png");
    expect(stored.originalFileName).toBe("unsafe.png");
    expect(stored.fileSizeBytes).toBe(png.byteLength);
    expect(stored.storageKey).toMatch(/^[0-9a-f-]{36}\.png$/i);

    const read = await readPrivateUpload(stored.storageKey);
    expect(read.mediaType).toBe("image/png");
    expect(read.buffer.equals(png)).toBe(true);

    await removePrivateUpload(stored.storageKey);
    await expect(readPrivateUpload(stored.storageKey)).rejects.toThrow();
  });

  it("rejects a spoofed or unsupported file signature", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "waste-storage-"));
    process.chdir(temporaryDirectory);
    await expect(storePrivateUpload({
      buffer: Buffer.from("this is not an image or PDF"),
      originalname: "fake.png",
      size: 28
    } as Express.Multer.File)).rejects.toBeInstanceOf(UnsupportedUploadError);
  });

  it("rejects path traversal storage keys", async () => {
    await expect(readPrivateUpload("../../etc/passwd")).rejects.toThrow("Invalid storage key.");
  });
});
