export class BoundedMap<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly maxEntries: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    return this.entries.get(key);
  }

  set(key: K, value: V) {
    if (this.entries.size >= this.maxEntries) {
      this.entries.clear();
    }

    this.entries.set(key, value);
  }

  delete(key: K) {
    this.entries.delete(key);
  }
}
