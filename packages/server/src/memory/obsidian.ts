import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/** Turn an arbitrary title into a safe Obsidian note filename (without extension). */
export function slugifyTitle(title: string): string {
  const base = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ") // characters Obsidian/filesystems dislike
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return base || "Untitled note";
}

export interface WriteNoteInput {
  title: string;
  body: string;
  chatId: string;
  harness: string;
  tags?: string[];
  /** Vault path override (from Settings). Falls back to config.obsidianVault. */
  vault?: string;
}

export interface WrittenNote {
  notePath: string;
  noteTitle: string;
  markdown: string;
}

/**
 * Write a distilled note into the configured Obsidian vault under OBSIDIAN_FOLDER.
 * Filenames collide-safely by appending a short timestamp suffix when needed.
 */
export function writeNote(input: WriteNoteInput): WrittenNote {
  const vault = input.vault?.trim() || config.obsidianVault;
  if (!vault) {
    throw new Error("Obsidian vault not configured (set it in Settings or OBSIDIAN_VAULT).");
  }

  const dir = path.join(vault, config.obsidianFolder);
  fs.mkdirSync(dir, { recursive: true });

  const title = slugifyTitle(input.title);
  let file = path.join(dir, `${title}.md`);
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    file = path.join(dir, `${title} ${stamp}.md`);
  }

  const tags = ["bobby", input.harness, ...(input.tags ?? [])];
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(input.title)}`,
    `created: ${new Date().toISOString()}`,
    `source: bobby`,
    `harness: ${input.harness}`,
    `chat_id: ${input.chatId}`,
    `tags: [${tags.join(", ")}]`,
    "---",
    "",
  ].join("\n");

  const markdown = `${frontmatter}${input.body.trim()}\n`;
  fs.writeFileSync(file, markdown, "utf8");

  return { notePath: file, noteTitle: input.title, markdown };
}
