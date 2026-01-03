//@ts-check

/**
 * @typedef {"file"|"dir"} NodeType
 */

/**
 * @typedef {{
 *   type: "file",
 *   name: string,
 *   parent: DirNode|null,
 *   data: string,
 *   mtime: number,
 *   ctime: number,
 * }} FileNode
 */

/**
 * @typedef {{
 *   type: "dir",
 *   name: string,
 *   parent: DirNode|null,
 *   children: Map<string, VfsNode>,
 *   mtime: number,
 *   ctime: number,
 * }} DirNode
 */

/** @typedef {FileNode|DirNode} VfsNode */

export class VirtualFileSystem {
  /** @type {DirNode} */
  root;

  constructor() {
    const now = Date.now();
    this.root = {
      type: "dir",
      name: "",
      parent: null,
      children: new Map(),
      ctime: now,
      mtime: now,
    };

    //Default File System
    this.mkdir("/home", { recursive: true });
    this.mkdir("/bin", { recursive: true });
    this.writeFile("/home/notes.txt", "hello vfs\n");
  }

  // -------------------------
  // Path helpers
  // -------------------------

  /**
   * @param {string} cwd
   * @param {string} path
   */
  resolve(cwd, path) {
    if (!path || path === "") return this._normalize(cwd || "/");
    if (path.startsWith("/")) return this._normalize(path);
    return this._normalize((cwd || "/").replace(/\/+$/, "") + "/" + path);
  }

  /**
   * @param {string} p
   */
  _normalize(p) {
    const parts = p.split("/").filter(Boolean);
    /** @type {string[]} */
    const stack = [];
    for (const part of parts) {
      if (part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return "/" + stack.join("/");
  }

  /**
   * @param {string} p
   */
  _split(p) {
    const abs = this._normalize(p);
    const parts = abs.split("/").filter(Boolean);
    return { abs, parts };
  }

  // -------------------------
  // Node lookup
  // -------------------------

  /**
   * @param {string} absPath normalized absolute path
   * @returns {VfsNode}
   */
  _getNode(absPath) {
    const { parts } = this._split(absPath);
    /** @type {VfsNode} */
    let cur = this.root;

    for (const name of parts) {
      if (cur.type !== "dir") throw new Error("not a directory: " + name);
      const next = cur.children.get(name);
      if (!next) throw new Error("no such file or directory: " + absPath);
      cur = next;
    }
    return cur;
  }

  /**
   * @param {string} absPath
   * @returns {{ parent: DirNode, name: string }}
   */
  _getParent(absPath) {
    const { parts, abs } = this._split(absPath);
    if (parts.length === 0) throw new Error("root has no parent: " + abs);
    const name = parts[parts.length - 1];
    const parentPath = "/" + parts.slice(0, -1).join("/");
    const parent = /** @type {DirNode} */ (this._getNode(parentPath === "/" ? "/" : parentPath));
    if (parent.type !== "dir") throw new Error("parent is not a directory: " + parentPath);
    return { parent, name };
  }

  // -------------------------
  // Public API
  // -------------------------

  /**
   * @param {string} path
   * @returns {{ type: NodeType, size: number, mtime: number, ctime: number }}
   */
  stat(path) {
    const n = this._getNode(path);
    if (n.type === "file") {
      return { type: "file", size: n.data.length, mtime: n.mtime, ctime: n.ctime };
    }
    return { type: "dir", size: n.children.size, mtime: n.mtime, ctime: n.ctime };
  }

  /**
   * @param {string} path
   */
  exists(path) {
    try { this._getNode(path); return true; } catch { return false; }
  }

  /**
   * @param {string} path
   */
  readdir(path) {
    const n = this._getNode(path);
    if (n.type !== "dir") throw new Error("not a directory: " + path);
    return [...n.children.keys()].sort();
  }

  /**
   * @param {string} path
   */
  readFile(path) {
    const n = this._getNode(path);
    if (n.type !== "file") throw new Error("not a file: " + path);
    return n.data;
  }

  /**
   * @param {string} path
   * @param {string} data
   */
  writeFile(path, data) {
    const abs = this._normalize(path);
    const now = Date.now();

    if (abs === "/") throw new Error("cannot write to /");

    const { parent, name } = this._getParent(abs);
    const existing = parent.children.get(name);

    if (existing && existing.type === "dir") throw new Error("is a directory: " + abs);

    /** @type {FileNode} */
    const file = existing && existing.type === "file"
      ? existing
      : { type: "file", name, parent, data: "", ctime: now, mtime: now };

    file.data = data;
    file.mtime = now;

    parent.children.set(name, file);
    parent.mtime = now;
  }

  /**
   * @param {string} path
   * @param {{recursive?: boolean}} [opts]
   */
  mkdir(path, opts = {}) {
    const abs = this._normalize(path);
    const { parts } = this._split(abs);
    let cur = this.root;
    const now = Date.now();

    for (const name of parts) {
      const next = cur.children.get(name);
      if (!next) {
        /** @type {DirNode} */
        const dir = { type: "dir", name, parent: cur, children: new Map(), ctime: now, mtime: now };
        cur.children.set(name, dir);
        cur.mtime = now;
        cur = dir;
        continue;
      }
      if (next.type !== "dir") throw new Error("not a directory: " + abs);
      cur = next;
    }
  }

   /**
   * Remove a file (POSIX-like unlink). Fails if path is a directory.
   * @param {string} path
   */
  unlink(path) {
    const abs = this._normalize(path);
    if (abs === "/") throw new Error("cannot unlink /");

    const { parent, name } = this._getParent(abs);
    const node = parent.children.get(name);

    if (!node) throw new Error("no such file or directory: " + abs);
    if (node.type !== "file") throw new Error("is a directory: " + abs);

    parent.children.delete(name);
    parent.mtime = Date.now();
  }

   /**
   * Remove a directory.
   * By default, the directory must be empty.
   *
   * @param {string} path
   * @param {{ recursive?: boolean }} [opts]
   */
  rmdir(path, opts = {}) {
    const abs = this._normalize(path);
    if (abs === "/") throw new Error("cannot remove root directory");

    const { parent, name } = this._getParent(abs);
    const node = parent.children.get(name);

    if (!node) throw new Error("no such file or directory: " + abs);
    if (node.type !== "dir") throw new Error("not a directory: " + abs);

    if (!opts.recursive && node.children.size > 0) {
      throw new Error("directory not empty: " + abs);
    }

    if (opts.recursive) {
      this._removeTree(node);
    }

    parent.children.delete(name);
    parent.mtime = Date.now();
  }

  /**
   * Recursively remove directory contents (internal helper)
   * @param {DirNode} dir
   */
  _removeTree(dir) {
    for (const child of dir.children.values()) {
      if (child.type === "dir") {
        this._removeTree(child);
      }
      // files are just dropped
    }
    dir.children.clear();
  }
}