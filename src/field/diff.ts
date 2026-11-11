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

/** One changed span: `fromOld`..`toOld` of the old text became `fromNew`..`toNew` of the new one. */
export interface Hunk {
  fromOld: number;
  toOld: number;
  fromNew: number;
  toNew: number;
}

/** Above this many line pairs to compare, `diffHunks` gives the one span `diffText` does. */
const MAX_LINE_PAIRS = 1_000_000;

/**
 * The spans that differ between two texts, in order and apart from one
 * another: the lines both texts share (a longest common subsequence) are left
 * out, and each run of changed lines is narrowed like `diffText`. Several
 * changes made at once (two `dd` far apart) are then written as several small
 * edits, never as one that rewrites the unchanged lines between them, an
 * Atom's among them.
 */
export function diffHunks(oldText: string, newText: string): Hunk[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  // Shared first and last lines need no search; they stay matched.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf])
    suf++;
  const n = a.length - suf;
  const m = b.length - suf;
  if ((n - pre) * (m - pre) > MAX_LINE_PAIRS) {
    const d = diffText(oldText, newText);
    return [{ fromOld: d.start, toOld: d.endOld, fromNew: d.start, toNew: d.endNew }];
  }
  /** Where each line starts. */
  const starts = (lines: string[]) => {
    const at = [0];
    for (const line of lines) at.push(at[at.length - 1]! + line.length + 1);
    return at;
  };
  const startA = starts(a);
  const startB = starts(b);
  // lcs[i - pre][j - pre]: how many lines a[i..n) and b[j..m) share, in order.
  const lcs = Array.from({ length: n - pre + 1 }, () => new Array<number>(m - pre + 1).fill(0));
  for (let i = n - pre - 1; i >= 0; i--) {
    for (let j = m - pre - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[pre + i] === b[pre + j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const common = (i: number, j: number) => lcs[i - pre]![j - pre]!;
  // A run of unmatched lines spans from the end of the shared line before it
  // to the start of the shared line after it, the newlines between included.
  const hunks: Hunk[] = [];
  let fromOld = pre > 0 ? startA[pre - 1]! + a[pre - 1]!.length : 0;
  let fromNew = pre > 0 ? startB[pre - 1]! + b[pre - 1]!.length : 0;
  const close = (toOld: number, toNew: number) => {
    if (fromOld === toOld && fromNew === toNew) return;
    const d = diffText(oldText.slice(fromOld, toOld), newText.slice(fromNew, toNew));
    if (d.start === d.endOld && d.start === d.endNew) return;
    hunks.push({
      fromOld: fromOld + d.start,
      toOld: fromOld + d.endOld,
      fromNew: fromNew + d.start,
      toNew: fromNew + d.endNew,
    });
  };
  let i = pre;
  let j = pre;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close(startA[i]!, startB[j]!);
      fromOld = startA[i]! + a[i]!.length;
      fromNew = startB[j]! + b[j]!.length;
      i++;
      j++;
    } else if (j < m && (i === n || common(i, j + 1) >= common(i + 1, j))) {
      j++;
    } else {
      i++;
    }
  }
  if (suf > 0) close(startA[n]!, startB[m]!);
  else close(oldText.length, newText.length);
  return hunks;
}
