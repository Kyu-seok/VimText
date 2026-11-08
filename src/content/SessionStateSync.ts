import {
  overlayLocalChanges,
  restoreGlobalState,
  snapshotGlobalState,
  type SessionState,
} from "../engine/globalState";

/** Where Session State lives: a one-time read, writes, and every tab's later writes. */
export interface SessionStatePort {
  load(): Promise<SessionState | null>;
  save(state: SessionState): Promise<void>;
  watch(handler: (s: SessionState) => void): () => void;
}

/**
 * Keeps this frame's engine global state and the shared Session State in step
 * (DESIGN.md "Session State"): after every key that changed the state the
 * snapshot is written; every write from any tab is restored before the next
 * key. Last writer wins. The engine's global state is one object per page, so
 * one instance serves every Session in the frame.
 */
export class SessionStateSync {
  /** The serialized state storage holds, as far as this tab knows; a snapshot equal to it is not written. */
  private lastSerialized: string | null = null;
  /** Serialized writes of ours whose storage change has not come back yet; the echo is not restored. */
  private readonly inFlight: string[] = [];
  private snapshotQueued = false;
  /** False until the storage read settles: nothing is written over state not yet read. */
  private loaded = false;
  /** A snapshot fell due while the read was pending; it is published once the read settles. */
  private publishPending = false;
  /** The engine's global state before this tab's first key, to tell what the keys changed from what was loaded. */
  private readonly before: SessionState;
  private readonly stopWatching: () => void;

  constructor(private readonly port: SessionStatePort) {
    this.stopWatching = port.watch(this.onChange);
    this.before = snapshotGlobalState();
    void port.load().then(
      (s) => this.onLoaded(s),
      // Right after install the service worker may not have granted access yet; start empty.
      (err: unknown) => {
        console.warn("VimText: Session State not read", err);
        this.onLoaded(null);
      },
    );
  }

  /** Something may have changed the engine's global state; the snapshot is taken once the current task is done. */
  queueSnapshot(): void {
    if (this.snapshotQueued) return;
    this.snapshotQueued = true;
    queueMicrotask(() => {
      this.snapshotQueued = false;
      this.publish();
    });
  }

  private publish(): void {
    if (!this.loaded) {
      this.publishPending = true;
      return;
    }
    const state = snapshotGlobalState();
    const serialized = JSON.stringify(state);
    if (serialized === this.lastSerialized) return;
    this.lastSerialized = serialized;
    this.inFlight.push(serialized);
    this.port.save(state).catch((err: unknown) => {
      // Quota or a missing grant: this tab keeps its in-memory state.
      console.warn("VimText: Session State not saved", err);
      const i = this.inFlight.indexOf(serialized);
      if (i >= 0) this.inFlight.splice(i, 1);
    });
  }

  /**
   * The storage read completed. A change delivered before it is newer than
   * what it returns (as for settings), so the read is then dropped. Keys
   * typed before it are newer too: what they changed is laid over the loaded
   * state, and the result is written back as this tab's first write.
   */
  private onLoaded(loadedState: SessionState | null): void {
    if (loadedState && this.lastSerialized === null) {
      restoreGlobalState(overlayLocalChanges(loadedState, snapshotGlobalState(), this.before));
      this.lastSerialized = JSON.stringify(loadedState);
    }
    this.loaded = true;
    if (this.publishPending) {
      this.publishPending = false;
      this.publish();
    }
  }

  private onChange = (s: SessionState): void => {
    const serialized = JSON.stringify(s);
    const i = this.inFlight.indexOf(serialized);
    if (i >= 0) {
      // Our own write coming back; restoring it over newer local state would lose keys typed since.
      this.inFlight.splice(i, 1);
      return;
    }
    restoreGlobalState(s);
    this.lastSerialized = serialized;
  };

  destroy(): void {
    this.stopWatching();
  }
}
