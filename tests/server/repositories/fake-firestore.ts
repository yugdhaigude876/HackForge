
interface FakeDoc {
  data: Record<string, unknown>;
}

export class FakeFirestore {
  private store = new Map<string, FakeDoc>();
  public batchCommitCount = 0;
  public batchWritesCount = 0;

  clear(): void {
    this.store.clear();
    this.batchCommitCount = 0;
    this.batchWritesCount = 0;
  }

  doc(path: string) {
    return new FakeDocRef(path, this.store);
  }

  collection(path: string) {
    return new FakeCollectionRef(path, this.store);
  }

  batch() {
    return new FakeWriteBatch(this.store, this);
  }
}

export class FakeDocRef {
  readonly id: string;
  readonly path: string;
  private store: Map<string, FakeDoc>;

  constructor(path: string, store: Map<string, FakeDoc>) {
    this.path = path.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
    this.id = this.path.split("/").pop() ?? "";
    this.store = store;
  }

  async get() {
    const doc = this.store.get(this.path);
    return {
      id: this.id,
      exists: Boolean(doc),
      data: () => (doc ? { ...doc.data } : undefined),
    };
  }

  async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
    if (options?.merge) {
      const existing = this.store.get(this.path);
      this.store.set(this.path, {
        data: { ...(existing?.data ?? {}), ...data },
      });
    } else {
      this.store.set(this.path, { data: { ...data } });
    }
  }

  async update(data: Record<string, unknown>) {
    const existing = this.store.get(this.path);
    if (!existing) {
      throw new Error(`Document ${this.path} not found to update`);
    }
    this.store.set(this.path, {
      data: { ...existing.data, ...data },
    });
  }

  async delete() {
    this.store.delete(this.path);
  }
}

export class FakeCollectionRef {
  readonly path: string;
  private store: Map<string, FakeDoc>;
  private filters: Array<{ field: string; op: string; val: unknown }> = [];
  private orderField?: string;
  private orderDirection?: "asc" | "desc";
  private limitCount?: number;

  constructor(path: string, store: Map<string, FakeDoc>) {
    this.path = path.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
    this.store = store;
  }

  doc(id?: string) {
    const docId = id ?? `auto_${Math.random().toString(36).substring(2, 10)}`;
    return new FakeDocRef(`${this.path}/${docId}`, this.store);
  }

  where(field: string, op: string, val: unknown) {
    const next = new FakeCollectionRef(this.path, this.store);
    next.filters = [...this.filters, { field, op, val }];
    next.orderField = this.orderField;
    next.orderDirection = this.orderDirection;
    next.limitCount = this.limitCount;
    return next;
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc") {
    const next = new FakeCollectionRef(this.path, this.store);
    next.filters = [...this.filters];
    next.orderField = field;
    next.orderDirection = direction;
    next.limitCount = this.limitCount;
    return next;
  }

  limit(count: number) {
    const next = new FakeCollectionRef(this.path, this.store);
    next.filters = [...this.filters];
    next.orderField = this.orderField;
    next.orderDirection = this.orderDirection;
    next.limitCount = count;
    return next;
  }

  async get() {
    const prefix = `${this.path}/`;
    let docs: Array<{ id: string; data: Record<string, unknown> }> = [];

    for (const [key, value] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        const sub = key.slice(prefix.length);
        if (!sub.includes("/")) {
          docs.push({ id: sub, data: value.data });
        }
      }
    }

    // Apply filters
    for (const filter of this.filters) {
      docs = docs.filter((d) => {
        const itemVal = d.data[filter.field];
        if (filter.op === "==") {
          return itemVal === filter.val;
        }
        if (filter.op === ">=") {
          // compare numbers or timestamps/dates
          const a = itemVal instanceof Date ? itemVal.getTime() : (itemVal as number);
          const b = filter.val instanceof Date ? filter.val.getTime() : (filter.val as number);
          return a >= b;
        }
        if (filter.op === "<=") {
          const a = itemVal instanceof Date ? itemVal.getTime() : (itemVal as number);
          const b = filter.val instanceof Date ? filter.val.getTime() : (filter.val as number);
          return a <= b;
        }
        return true;
      });
    }

    // Apply ordering
    if (this.orderField) {
      const field = this.orderField;
      const isAsc = this.orderDirection === "asc";
      docs.sort((a, b) => {
        const valA = a.data[field];
        const valB = b.data[field];
        const numA = valA instanceof Date ? valA.getTime() : String(valA ?? "");
        const numB = valB instanceof Date ? valB.getTime() : String(valB ?? "");
        if (numA < numB) return isAsc ? -1 : 1;
        if (numA > numB) return isAsc ? 1 : -1;
        return 0;
      });
    }

    // Apply limit
    if (this.limitCount !== undefined) {
      docs = docs.slice(0, this.limitCount);
    }

    return {
      docs: docs.map((d) => ({
        id: d.id,
        data: () => ({ ...d.data }),
      })),
    };
  }
}

export class FakeWriteBatch {
  private operations: Array<() => Promise<void>> = [];
  private fakeDb: FakeFirestore;

  constructor(store: Map<string, FakeDoc>, fakeDb: FakeFirestore) {
    this.fakeDb = fakeDb;
  }

  set(docRef: FakeDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) {
    this.operations.push(async () => {
      await docRef.set(data, options);
    });
    return this;
  }

  update(docRef: FakeDocRef, data: Record<string, unknown>) {
    this.operations.push(async () => {
      await docRef.update(data);
    });
    return this;
  }

  delete(docRef: FakeDocRef) {
    this.operations.push(async () => {
      await docRef.delete();
    });
    return this;
  }

  async commit(): Promise<void> {
    for (const op of this.operations) {
      await op();
    }
    this.fakeDb.batchWritesCount += this.operations.length;
    this.fakeDb.batchCommitCount += 1;
    this.operations = [];
  }
}
