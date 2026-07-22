/**
 * Generate one-time signup invite codes.
 *
 * Stores only SHA-256 hashes in the server database (same DATA_DIR resolution
 * as the server) and appends the plaintext codes to invite-codes.md as a
 * markdown checklist, the file is the single plaintext copy and is gitignored.
 *
 * Usage: bun scripts/generate-more-invite-codes.ts [count]   (default 50)
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { db, dbPath } from "../apps/server/src/db/index.ts";
import { inviteCodeTable } from "../apps/server/src/db/schema.ts";
import {
  generateInviteCode,
  hashInviteCode,
} from "../apps/server/src/lib/inviteCodes.ts";

const rawCount = process.argv[2] ?? "50";
const count = Number(rawCount);
if (!Number.isInteger(count) || count < 1 || count > 1000) {
  console.error(`Invalid count "${rawCount}", expected an integer between 1 and 1000.`);
  process.exit(1);
}

const createdAt = new Date();
const codes: string[] = Array.from({ length: count }, () => generateInviteCode());

const mdPath = join(import.meta.dir, "..", "invite-codes.md");
const mdFile = Bun.file(mdPath);
const existing = (await mdFile.exists()) ? await mdFile.text() : "";

let out = existing;
if (!existing.trim()) {
  out =
    "# Invite codes\n\n" +
    "One-time codes required to create an account. Check a code off once you " +
    "know it has been used. The server stores only hashes; this file is the " +
    "only plaintext copy and must stay out of git.\n";
}
if (!out.endsWith("\n")) out += "\n";
out += `\n## Generated ${createdAt.toISOString()} (${count} codes)\n\n`;
out += codes.map((c) => `- [ ] \`${c}\``).join("\n") + "\n";

// Plaintext first, hashes second: if the DB insert dies mid-way the appended
// codes are merely inert (and the file is restored below), whereas hashes
// without plaintext would be unrecoverable burned inventory.
await Bun.write(mdPath, out);
try {
  await db.transaction(async (tx) => {
    for (const code of codes) {
      await tx.insert(inviteCodeTable).values({
        id: randomBytes(16).toString("hex"),
        codeHash: hashInviteCode(code),
        createdAt,
      });
    }
  });
} catch (e) {
  await Bun.write(mdPath, existing);
  console.error("Database insert failed; invite-codes.md was restored. No codes were created.");
  throw e;
}

console.log(`Inserted ${count} invite code hashes into ${dbPath}`);
console.log(`Appended ${count} plaintext codes to ${mdPath}`);
