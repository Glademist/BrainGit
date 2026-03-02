import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs-extra";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import yaml from "js-yaml";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NOTES_DIR = path.join(__dirname, "data", "notes");
const CONFIG_DIR = path.join(__dirname, "data", "config");
const PASSWORD_FILE = path.join(CONFIG_DIR, "password.hash");

// Ensure directories exist
fs.ensureDirSync(NOTES_DIR);
fs.ensureDirSync(CONFIG_DIR);

// Initialize Git if not already
async function initGit() {
  try {
    const exists = await fs.pathExists(path.join(NOTES_DIR, ".git"));
    if (!exists) {
      await git.init({ fs, dir: NOTES_DIR });
      console.log("Git repository initialized.");
    }
  } catch (err) {
    console.error("Failed to initialize Git:", err);
  }
}
initGit();

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cookieParser());

// Auth Middleware
const auth = (req: any, res: any, next: any) => {
  const session = req.cookies.session;
  if (session === "authenticated") {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

// --- Auth Routes ---
app.post("/api/auth/login", async (req, res) => {
  const { password } = req.body;
  
  // For demo/initial setup, if no password exists, set it
  if (!fs.existsSync(PASSWORD_FILE)) {
    const hash = await bcrypt.hash(password, 10);
    fs.writeFileSync(PASSWORD_FILE, hash);
    res.cookie("session", "authenticated", { httpOnly: true, sameSite: "none", secure: true });
    return res.json({ success: true, message: "Password set and logged in" });
  }

  const hash = fs.readFileSync(PASSWORD_FILE, "utf-8");
  const match = await bcrypt.compare(password, hash);
  if (match) {
    res.cookie("session", "authenticated", { httpOnly: true, sameSite: "none", secure: true });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("session");
  res.json({ success: true });
});

app.get("/api/auth/check", (req, res) => {
  if (req.cookies.session === "authenticated") {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

// --- File Routes ---
app.get("/api/files", auth, async (req, res) => {
  try {
    const getTree = async (dir: string, base: string = ""): Promise<any[]> => {
      const items = await fs.readdir(dir);
      const result = [];
      for (const item of items) {
        if (item === ".git") continue;
        const fullPath = path.join(dir, item);
        const relPath = path.join(base, item);
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          result.push({
            name: item,
            path: relPath,
            type: "directory",
            children: await getTree(fullPath, relPath),
          });
        } else if (item.endsWith(".md")) {
          result.push({
            name: item.replace(".md", ""),
            path: relPath,
            type: "file",
          });
        }
      }
      return result;
    };
    const tree = await getTree(NOTES_DIR);
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: "Failed to read files" });
  }
});

app.get("/api/files/content", auth, async (req, res) => {
  const { filePath } = req.query;
  if (typeof filePath !== "string") return res.status(400).json({ error: "Invalid path" });
  try {
    const fullPath = path.join(NOTES_DIR, filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    res.json({ content });
  } catch (err) {
    res.status(404).json({ error: "File not found" });
  }
});

app.post("/api/files/save", auth, async (req, res) => {
  const { filePath, content } = req.body;
  try {
    const fullPath = path.join(NOTES_DIR, filePath);
    await fs.writeFile(fullPath, content);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save file" });
  }
});

app.post("/api/files/create", auth, async (req, res) => {
  const { name, type, parentPath = "" } = req.body;
  try {
    const targetName = type === "file" ? `${name}.md` : name;
    const fullPath = path.join(NOTES_DIR, parentPath, targetName);
    if (type === "file") {
      await fs.writeFile(fullPath, `# ${name}\n`);
    } else {
      await fs.ensureDir(fullPath);
    }
    
    // Auto-commit file creation
    await git.add({ fs, dir: NOTES_DIR, filepath: path.join(parentPath, targetName) });
    await git.commit({
      fs,
      dir: NOTES_DIR,
      message: `Created ${type}: ${name}`,
      author: { name: "BrainGit User", email: "user@braingit.local" }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to create item" });
  }
});

app.post("/api/files/delete", auth, async (req, res) => {
  const { filePath } = req.body;
  try {
    const fullPath = path.join(NOTES_DIR, filePath);
    await fs.remove(fullPath);
    
    // Git remove (isomorphic-git remove doesn't handle non-existent files well sometimes, so we just commit the change)
    await git.add({ fs, dir: NOTES_DIR, filepath: filePath }); // This might fail if file is gone, so we use status
    await git.commit({
      fs,
      dir: NOTES_DIR,
      message: `Deleted: ${filePath}`,
      author: { name: "BrainGit User", email: "user@braingit.local" }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete item" });
  }
});

// --- Git Routes ---
app.get("/api/git/history", auth, async (req, res) => {
  const { filePath } = req.query;
  if (typeof filePath !== "string") return res.status(400).json({ error: "Invalid path" });
  try {
    const commits = await git.log({ fs, dir: NOTES_DIR });
    // Filter commits that affected this file (simplified for now, isomorphic-git doesn't have a built-in file history filter easily)
    // We'll return all commits for now, but in a real app we'd filter.
    res.json(commits.map(c => ({
      oid: c.oid,
      message: c.commit.message,
      timestamp: c.commit.author.timestamp,
      author: c.commit.author.name
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to get history" });
  }
});

app.post("/api/git/snapshot", auth, async (req, res) => {
  const { message = "Manual snapshot" } = req.body;
  try {
    await git.add({ fs, dir: NOTES_DIR, filepath: "." });
    const oid = await git.commit({
      fs,
      dir: NOTES_DIR,
      message,
      author: { name: "BrainGit User", email: "user@braingit.local" }
    });
    res.json({ success: true, oid });
  } catch (err) {
    res.status(500).json({ error: "Failed to create snapshot" });
  }
});

app.get("/api/git/show", auth, async (req, res) => {
  const { oid, filePath } = req.query;
  if (typeof oid !== "string" || typeof filePath !== "string") return res.status(400).json({ error: "Invalid params" });
  try {
    const { blob } = await git.readBlob({
      fs,
      dir: NOTES_DIR,
      oid: await git.resolveRef({ fs, dir: NOTES_DIR, ref: oid }),
      filepath: filePath
    });
    const content = Buffer.from(blob).toString("utf8");
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: "Failed to read version" });
  }
});

// --- Vite Middleware ---
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "dist", "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
