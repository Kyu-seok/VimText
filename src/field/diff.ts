/** The one span that differs between two texts, as the bounds of their common prefix and suffix. */
export interface TextDiff {
  /** Length of the common prefix: where the change starts in both texts. */
  start: number;
  /** End of the changed span in `oldText`. */
  endOld: number;
  /** End of the changed span in `newText`. */
  endNew: number;
}

/** Narrows the edit that turns `oldText` into `newText` to a single replacement, the way a diff of one change would. */
export function diffText(oldText: string, newText: string): TextDiff {
  let start = 0;
  const max = Math.min(oldText.length, newText.length);
  while (start < max && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (
    endOld > start &&
    endNew > start &&
    oldText.charCodeAt(endOld - 1) === newText.charCodeAt(endNew - 1)
  ) {
    endOld--;
    endNew--;
  }
  return { start, endOld, endNew };
}
