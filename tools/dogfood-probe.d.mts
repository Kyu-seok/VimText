/** What `installProbe` leaves on the page as `window.__vimtextProbe`. */
export interface DogfoodProbe {
  /** Names the Field under test and focuses it; from here a key arriving outside it is stopped and listed. */
  watch(el: HTMLElement, options?: { enterSends?: boolean }): void;
  /** JSON of the Field's text, selection, focus, the shown Status Lines, and the leaks and focus moves since the last call. */
  state(): string;
}

/** Runs in the page: installs the key guard and the readers, and returns the probe. */
export function installProbe(): DogfoodProbe;
