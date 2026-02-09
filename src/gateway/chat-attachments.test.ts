import { describe, expect, it } from "vitest";
import {
  buildMessageWithAttachments,
  type ChatAttachment,
  parseMessageWithAttachments,
} from "./chat-attachments.js";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

describe("buildMessageWithAttachments", () => {
  it("embeds a single image as data URL", () => {
    const msg = buildMessageWithAttachments("see this", [
      {
        type: "image",
        mimeType: "image/png",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(msg).toContain("see this");
    expect(msg).toContain(`data:image/png;base64,${PNG_1x1}`);
    expect(msg).toContain("![dot.png]");
  });

  it("rejects non-image mime types", () => {
    const bad: ChatAttachment = {
      type: "file",
      mimeType: "application/pdf",
      fileName: "a.pdf",
      content: "AAA",
    };
    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/image/);
  });

  it("rejects invalid base64 content", () => {
    const bad: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "dot.png",
      content: "%not-base64%",
    };
    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/base64/);
  });

  it("rejects images over limit", () => {
    const big = Buffer.alloc(6_000_000, 0).toString("base64");
    const att: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "big.png",
      content: big,
    };
    expect(() => buildMessageWithAttachments("x", [att], { maxBytes: 5_000_000 })).toThrow(
      /exceeds size limit/i,
    );
  });
});

describe("parseMessageWithAttachments", () => {
  it("strips data URL prefix", async () => {
    const parsed = await parseMessageWithAttachments(
      "see this",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "dot.png",
          content: `data:image/png;base64,${PNG_1x1}`,
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
  });

  it("rejects invalid base64 content", async () => {
    await expect(
      parseMessageWithAttachments(
        "x",
        [
          {
            type: "image",
            mimeType: "image/png",
            fileName: "dot.png",
            content: "%not-base64%",
          },
        ],
        { log: { warn: () => {} } },
      ),
    ).rejects.toThrow(/base64/i);
  });

  it("rejects images over limit", async () => {
    const big = Buffer.alloc(6_000_000, 0).toString("base64");
    await expect(
      parseMessageWithAttachments(
        "x",
        [
          {
            type: "image",
            mimeType: "image/png",
            fileName: "big.png",
            content: big,
          },
        ],
        { maxBytes: 5_000_000, log: { warn: () => {} } },
      ),
    ).rejects.toThrow(/exceeds size limit/i);
  });

  it("sniffs mime when missing", async () => {
    const logs: string[] = [];
    const parsed = await parseMessageWithAttachments(
      "see this",
      [
        {
          type: "image",
          fileName: "dot.png",
          content: PNG_1x1,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.message).toBe("see this\n\n[Image attached: dot.png (image/png)]");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(logs).toHaveLength(0);
  });

  it("handles non-image payloads as placeholder and collects binary", async () => {
    const logs: string[] = [];
    const pdf = Buffer.from("%PDF-1.4\n").toString("base64");
    const parsed = await parseMessageWithAttachments(
      "x",
      [
        {
          type: "file",
          mimeType: "image/png",
          fileName: "not-image.pdf",
          content: pdf,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(parsed.message).toContain("[File attached:");
    expect(parsed.binaryFiles).toHaveLength(1);
    expect(parsed.binaryFiles[0]?.fileName).toBe("not-image.pdf");
  });

  it("prefers sniffed mime type and logs mismatch", async () => {
    const logs: string[] = [];
    const parsed = await parseMessageWithAttachments(
      "x",
      [
        {
          type: "image",
          mimeType: "image/jpeg",
          fileName: "dot.png",
          content: PNG_1x1,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/mime mismatch/i);
  });

  it("handles unknown mime as placeholder and collects binary", async () => {
    const logs: string[] = [];
    const unknown = Buffer.from("not an image").toString("base64");
    const parsed = await parseMessageWithAttachments(
      "x",
      [{ type: "file", fileName: "unknown.bin", content: unknown }],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(parsed.message).toContain("[File attached: unknown.bin");
    expect(parsed.binaryFiles).toHaveLength(1);
    expect(parsed.binaryFiles[0]?.fileName).toBe("unknown.bin");
  });

  it("injects text file content as fenced code block", async () => {
    const logs: string[] = [];
    const csvContent = "name,age\nAlice,30\nBob,25";
    const csvBase64 = Buffer.from(csvContent).toString("base64");
    const parsed = await parseMessageWithAttachments(
      "analyze this",
      [
        {
          type: "file",
          mimeType: "text/csv",
          fileName: "data.csv",
          content: csvBase64,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(parsed.message).toContain("analyze this");
    expect(parsed.message).toContain("[File: data.csv]");
    expect(parsed.message).toContain("```csv");
    expect(parsed.message).toContain(csvContent);
    expect(logs).toHaveLength(0);
  });

  it("injects JSON file by extension even without text mime", async () => {
    const logs: string[] = [];
    const jsonContent = '{"key": "value"}';
    const jsonBase64 = Buffer.from(jsonContent).toString("base64");
    const parsed = await parseMessageWithAttachments(
      "check",
      [
        {
          type: "file",
          fileName: "config.json",
          content: jsonBase64,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(parsed.message).toContain("[File: config.json]");
    expect(parsed.message).toContain("```json");
    expect(parsed.message).toContain(jsonContent);
    expect(logs).toHaveLength(0);
  });

  it("adds placeholder for binary files and collects them", async () => {
    const logs: string[] = [];
    const zipHeader = Buffer.from("PK\x03\x04fake-zip-content");
    const parsed = await parseMessageWithAttachments(
      "open this",
      [
        {
          type: "file",
          mimeType: "application/zip",
          fileName: "archive.zip",
          content: zipHeader.toString("base64"),
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(0);
    expect(parsed.message).toContain("open this");
    expect(parsed.message).toContain("[File attached: archive.zip");
    expect(parsed.binaryFiles).toHaveLength(1);
    expect(parsed.binaryFiles[0]?.fileName).toBe("archive.zip");
    expect(parsed.binaryFiles[0]?.mimeType).toBe("application/zip");
  });

  it("keeps valid images and collects invalid ones as binary", async () => {
    const logs: string[] = [];
    const pdf = Buffer.from("%PDF-1.4\n").toString("base64");
    const parsed = await parseMessageWithAttachments(
      "x",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "dot.png",
          content: PNG_1x1,
        },
        {
          type: "file",
          mimeType: "image/png",
          fileName: "not-image.pdf",
          content: pdf,
        },
      ],
      { log: { warn: (message) => logs.push(message) } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(parsed.message).toContain("[File attached:");
    expect(parsed.binaryFiles).toHaveLength(1);
    expect(parsed.binaryFiles[0]?.fileName).toBe("not-image.pdf");
  });
});
