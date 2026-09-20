/**
 * Writes `gameId: "fuse-riders"` onto every match record that predates games, so Fuse Riders' history query can
 * filter on `gameId` like every other game's. Each such record already reads as Fuse Riders', so the write changes
 * no meaning and is safe to repeat; a record that has any `gameId` is never touched.
 *
 * Dry run by default: it counts and prints, and writes nothing. Pass `--apply` to write.
 *
 *   ROOM_COLLECTION_PREFIX=fuse-production pnpm exec tsx scripts/backfill-match-game-id.ts [--apply]
 *
 * Uses Application Default Credentials; GOOGLE_CLOUD_PROJECT and FIRESTORE_DATABASE_ID pick the database.
 */
import { FieldPath, Firestore } from "@google-cloud/firestore";
import { LEGACY_GAME_FIELD, legacyMatchIds } from "fuse-platform";

const PAGE = 400; // Under Firestore's 500 writes per batch.
const apply = process.argv.includes("--apply");
const prefix = process.env.ROOM_COLLECTION_PREFIX;
if (!prefix || !/^[a-z][a-z0-9-]{1,50}$/.test(prefix))
  throw new Error("Set ROOM_COLLECTION_PREFIX, e.g. fuse-production");
const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "andershaf-87",
  databaseId: process.env.FIRESTORE_DATABASE_ID ?? "fuse-riders",
});
const matches = firestore.collection(`${prefix}-matches`);

let scanned = 0,
  legacy = 0,
  after: string | undefined;
for (;;) {
  let query = matches.orderBy(FieldPath.documentId()).limit(PAGE);
  if (after !== undefined) query = query.startAfter(after);
  const page = await query.get();
  if (page.empty) break;
  const ids = legacyMatchIds(
    page.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  );
  scanned += page.size;
  legacy += ids.length;
  if (apply && ids.length) {
    const batch = firestore.batch();
    for (const id of ids) batch.update(matches.doc(id), LEGACY_GAME_FIELD);
    await batch.commit();
  }
  after = page.docs[page.docs.length - 1]!.id;
  console.log(`${scanned} scanned, ${legacy} without gameId`);
}
console.log(
  apply
    ? `Done: wrote gameId onto ${legacy} of ${scanned} ${prefix}-matches records.`
    : `Dry run: ${legacy} of ${scanned} ${prefix}-matches records need gameId. Rerun with --apply to write.`,
);
