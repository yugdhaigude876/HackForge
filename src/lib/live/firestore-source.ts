import { doc, collection, query, orderBy, limit as qLimit, onSnapshot } from "firebase/firestore";
import { getFirestoreDb } from "@/lib/firebase/firestore-client";
import type { LiveClock, LiveSource, StreamTick } from "./types";

/** Default LiveSource: Firestore realtime listeners. Read-only; writes are server-only by rules. */
export const firestoreLiveSource: LiveSource = {
  subscribeClock(orgId, onNext, onError) {
    const db = getFirestoreDb();
    if (!db) {
      onError({ code: "unavailable", message: "Firestore is not configured." });
      return () => undefined;
    }
    return onSnapshot(
      doc(db, "orgs", orgId, "clock", "state"),
      { includeMetadataChanges: true },
      (snap) => onNext(snap.exists() ? (snap.data() as LiveClock) : null, { fromCache: snap.metadata.fromCache }),
      (err) => onError({ code: err.code, message: err.message })
    );
  },

  subscribeStream(orgId, limit, onNext, onError) {
    const db = getFirestoreDb();
    if (!db) {
      onError({ code: "unavailable", message: "Firestore is not configured." });
      return () => undefined;
    }
    const q = query(collection(db, "orgs", orgId, "stream"), orderBy("hourIndex", "desc"), qLimit(limit));
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) =>
        onNext(
          snap.docs.map((d) => d.data() as StreamTick),
          { fromCache: snap.metadata.fromCache }
        ),
      (err) => onError({ code: err.code, message: err.message })
    );
  },
};
