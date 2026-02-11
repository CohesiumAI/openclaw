import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProject,
  deleteProject,
  getProjectFile,
  listProjects,
  putProjectFile,
  removeProjectFiles,
  updateProject,
} from "./user-projects.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-projects-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("user-projects — CRUD", () => {
  it("listProjects returns empty for a fresh user", () => {
    expect(listProjects("alice", tmpDir)).toEqual([]);
  });

  it("createProject returns the project with correct fields", () => {
    const p = createProject("alice", { id: "proj-1", name: "My Project", color: "#22c55e" }, tmpDir);
    expect(p).not.toBeNull();
    expect(p!.id).toBe("proj-1");
    expect(p!.name).toBe("My Project");
    expect(p!.color).toBe("#22c55e");
    expect(p!.sessionKeys).toEqual([]);
    expect(p!.files).toEqual([]);
    expect(p!.createdAt).toBeGreaterThan(0);
  });

  it("createProject persists and is visible in listProjects", () => {
    createProject("alice", { id: "proj-1", name: "P1", color: "#fff" }, tmpDir);
    createProject("alice", { id: "proj-2", name: "P2", color: "#000" }, tmpDir);
    const projects = listProjects("alice", tmpDir);
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.id)).toEqual(["proj-1", "proj-2"]);
  });

  it("rejects duplicate project id", () => {
    createProject("alice", { id: "proj-1", name: "P1", color: "#fff" }, tmpDir);
    const dup = createProject("alice", { id: "proj-1", name: "P1-dup", color: "#000" }, tmpDir);
    expect(dup).toBeNull();
    expect(listProjects("alice", tmpDir)).toHaveLength(1);
  });

  it("rejects invalid project id (path traversal)", () => {
    expect(createProject("alice", { id: "../evil", name: "E", color: "#f00" }, tmpDir)).toBeNull();
    expect(createProject("alice", { id: "", name: "E", color: "#f00" }, tmpDir)).toBeNull();
    expect(createProject("alice", { id: "a".repeat(65), name: "E", color: "#f00" }, tmpDir)).toBeNull();
  });

  it("isolates users", () => {
    createProject("alice", { id: "proj-1", name: "Alice P", color: "#fff" }, tmpDir);
    createProject("bob", { id: "proj-1", name: "Bob P", color: "#000" }, tmpDir);
    expect(listProjects("alice", tmpDir)).toHaveLength(1);
    expect(listProjects("alice", tmpDir)[0].name).toBe("Alice P");
    expect(listProjects("bob", tmpDir)[0].name).toBe("Bob P");
  });

  it("truncates long name and color", () => {
    const p = createProject("alice", { id: "proj-1", name: "x".repeat(300), color: "y".repeat(50) }, tmpDir);
    expect(p!.name.length).toBe(200);
    expect(p!.color.length).toBe(30);
  });

  describe("updateProject", () => {
    it("updates name, color, and sessionKeys", () => {
      createProject("alice", { id: "proj-1", name: "Old", color: "#fff" }, tmpDir);
      const updated = updateProject("alice", "proj-1", { name: "New", color: "#000", sessionKeys: ["s1"] }, tmpDir);
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("New");
      expect(updated!.color).toBe("#000");
      expect(updated!.sessionKeys).toEqual(["s1"]);
    });

    it("returns null for non-existent project", () => {
      expect(updateProject("alice", "nope", { name: "X" }, tmpDir)).toBeNull();
    });

    it("partial update only touches specified fields", () => {
      createProject("alice", { id: "proj-1", name: "N", color: "#fff", sessionKeys: ["s1"] }, tmpDir);
      const updated = updateProject("alice", "proj-1", { name: "N2" }, tmpDir);
      expect(updated!.name).toBe("N2");
      expect(updated!.color).toBe("#fff"); // untouched
      expect(updated!.sessionKeys).toEqual(["s1"]); // untouched
    });
  });

  describe("deleteProject", () => {
    it("removes the project and returns true", () => {
      createProject("alice", { id: "proj-1", name: "P", color: "#fff" }, tmpDir);
      expect(deleteProject("alice", "proj-1", tmpDir)).toBe(true);
      expect(listProjects("alice", tmpDir)).toEqual([]);
    });

    it("returns false for non-existent project", () => {
      expect(deleteProject("alice", "nope", tmpDir)).toBe(false);
    });

    it("cleans up files on disk when deleting a project", () => {
      createProject("alice", { id: "proj-1", name: "P", color: "#fff" }, tmpDir);
      putProjectFile("alice", "proj-1", { fileId: "f1", fileName: "a.txt", dataUrl: "data:text/plain;base64,SGVsbG8=" }, tmpDir);
      const userDir = path.join(tmpDir, "user-projects", "alice", "files", "proj-1");
      expect(fs.existsSync(userDir)).toBe(true);
      deleteProject("alice", "proj-1", tmpDir);
      expect(fs.existsSync(userDir)).toBe(false);
    });
  });
});

describe("user-projects — File storage", () => {
  beforeEach(() => {
    createProject("alice", { id: "proj-1", name: "P", color: "#fff" }, tmpDir);
  });

  it("putProjectFile stores and getProjectFile retrieves", () => {
    const meta = putProjectFile("alice", "proj-1", {
      fileId: "f1",
      fileName: "hello.txt",
      dataUrl: "data:text/plain;base64,SGVsbG8=",
      mimeType: "text/plain",
      sessionKey: "main",
    }, tmpDir);
    expect(meta).not.toBeNull();
    expect(meta!.id).toBe("f1");
    expect(meta!.fileName).toBe("hello.txt");
    expect(meta!.mimeType).toBe("text/plain");
    expect(meta!.sessionKey).toBe("main");

    const file = getProjectFile("alice", "proj-1", "f1", tmpDir);
    expect(file).not.toBeNull();
    expect(file!.dataUrl).toBe("data:text/plain;base64,SGVsbG8=");
    expect(file!.fileName).toBe("hello.txt");
  });

  it("returns null for non-existent file", () => {
    expect(getProjectFile("alice", "proj-1", "nope", tmpDir)).toBeNull();
  });

  it("returns null for non-existent project", () => {
    expect(putProjectFile("alice", "nope", { fileId: "f1", fileName: "x", dataUrl: "abc" }, tmpDir)).toBeNull();
  });

  it("rejects unsafe file IDs", () => {
    expect(putProjectFile("alice", "proj-1", { fileId: "../evil", fileName: "x", dataUrl: "abc" }, tmpDir)).toBeNull();
    expect(getProjectFile("alice", "proj-1", "../evil", tmpDir)).toBeNull();
  });

  it("updates existing file metadata on re-put", () => {
    putProjectFile("alice", "proj-1", { fileId: "f1", fileName: "v1.txt", dataUrl: "old" }, tmpDir);
    putProjectFile("alice", "proj-1", { fileId: "f1", fileName: "v2.txt", dataUrl: "new" }, tmpDir);
    const projects = listProjects("alice", tmpDir);
    // Should have exactly 1 file entry, not 2
    expect(projects[0].files).toHaveLength(1);
    expect(projects[0].files[0].fileName).toBe("v2.txt");
    const file = getProjectFile("alice", "proj-1", "f1", tmpDir);
    expect(file!.dataUrl).toBe("new");
  });

  describe("removeProjectFiles", () => {
    it("removes specified files and returns count", () => {
      putProjectFile("alice", "proj-1", { fileId: "f1", fileName: "a", dataUrl: "d1" }, tmpDir);
      putProjectFile("alice", "proj-1", { fileId: "f2", fileName: "b", dataUrl: "d2" }, tmpDir);
      putProjectFile("alice", "proj-1", { fileId: "f3", fileName: "c", dataUrl: "d3" }, tmpDir);
      const removed = removeProjectFiles("alice", "proj-1", ["f1", "f3"], tmpDir);
      expect(removed).toBe(2);
      expect(getProjectFile("alice", "proj-1", "f1", tmpDir)).toBeNull();
      expect(getProjectFile("alice", "proj-1", "f2", tmpDir)).not.toBeNull();
      expect(getProjectFile("alice", "proj-1", "f3", tmpDir)).toBeNull();
    });

    it("returns 0 for unknown file IDs", () => {
      expect(removeProjectFiles("alice", "proj-1", ["nope"], tmpDir)).toBe(0);
    });

    it("returns 0 for non-existent project", () => {
      expect(removeProjectFiles("alice", "nope", ["f1"], tmpDir)).toBe(0);
    });
  });
});
