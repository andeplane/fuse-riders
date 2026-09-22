/**
 * Writes `feedAt` onto every match record that earned a place in the public feed but was confirmed before the field
 * existed. The feed query orders by `feedAt` and Firestore returns no document that lacks the field it orders by, so
 * those games are in nobody's EVERYONE tab while still being in their own players' YOURS tab. `feedAt` is stamped
 * from the record's own `endedAt`, exactly as confirmation stamps it, so a backfilled game sorts and pages like one
 * confirmed today and is still dated by when it ended.
 *
 * Only a confirmed whole game an account owns a seat in, or that two riders attested, is stamped — the same rule
 * confirmation applies. A record that already has a `feedAt` is never touched, so this is safe to repeat.
 *
 * Run `scripts/backfill-match-game-id.ts` first if records from before games carry a game: the feed filters on
 * `gameId` before it orders, so a record without one stays invisible whatever its `feedAt`.
 *
 * Dry run by default: it counts and prints, and writes nothing. Pass `--apply` to write.
 *
 *   ROOM_COLLECTION_PREFIX=fuse-production pnpm exec tsx scripts/backfill-match-feed-at.ts [--apply]
 *
 * Uses Application Default Credentials; GOOGLE_CLOUD_PROJECT and FIRESTORE_DATABASE_ID pick the database.
 */
import { FieldPath, Firestore } from "@google-cloud/firestore";
import { feedlessMatchStamps } from "fuse-platform";

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
  stamped = 0,
  after: string | undefined;
for (;;) {
  let query = matches.orderBy(FieldPath.documentId()).limit(PAGE);
  if (after !== undefined) query = query.startAfter(after);
  const page = await query.get();
  if (page.empty) break;
  const stamps = feedlessMatchStamps(
    page.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  );
  scanned += page.size;
  stamped += stamps.length;
  if (apply && stamps.length) {
    const batch = firestore.batch();
    for (const { id, feedAt } of stamps)
      batch.update(matches.doc(id), { feedAt });
    await batch.commit();
  }
  after = page.docs[page.docs.length - 1]!.id;
  console.log(`${scanned} scanned, ${stamped} without feedAt`);
}
console.log(
  apply
    ? `Done: wrote feedAt onto ${stamped} of ${scanned} ${prefix}-matches records.`
    : `Dry run: ${stamped} of ${scanned} ${prefix}-matches records need feedAt. Rerun with --apply to write.`,
);
