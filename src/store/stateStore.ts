import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DeadLetter, RunReport } from "../types.js";

export interface SyncState {
  cursor: string | null;
  processed: Record<string, string>; // idempotency key -> delivered at
  deadLetters: DeadLetter[];
  runs: RunReport[];
}

const empty = (): SyncState => ({ cursor: null, processed: {}, deadLetters: [], runs: [] });

export interface StateStore {
  load(): Promise<SyncState>;
  save(state: SyncState): Promise<void>;
}

export class MemoryStateStore implements StateStore {
  private state = empty();
  async load() {
    return structuredClone(this.state);
  }
  async save(state: SyncState) {
    this.state = structuredClone(state);
  }
}

/** JSON file store with atomic writes (write temp file, then rename) so a crash never leaves half a file. */
export class FileStateStore implements StateStore {
  constructor(private path: string) {}
  async load(): Promise<SyncState> {
    try {
      return { ...empty(), ...JSON.parse(await readFile(this.path, "utf8")) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw err;
    }
  }
  async save(state: SyncState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, this.path);
  }
}
