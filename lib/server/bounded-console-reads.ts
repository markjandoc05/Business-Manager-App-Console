import { FieldPath, type CollectionReference, type DocumentSnapshot, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

const READ_PAGE_SIZE = 100;
const READ_CONCURRENCY = 5;

/** Keep existing complete list contracts while bounding each query and fanout. */
export async function readCollectionPages(collection: CollectionReference) {
  const items: QueryDocumentSnapshot[] = [];
  let cursor: DocumentSnapshot | undefined;
  for (;;) {
    let query = collection.orderBy(FieldPath.documentId()).limit(READ_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    items.push(...snapshot.docs);
    if (snapshot.size < READ_PAGE_SIZE) return items;
    cursor = snapshot.docs.at(-1);
  }
}

export async function mapConsoleReads<T, R>(items: T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await read(items[index]);
    }
  }));
  return results;
}
