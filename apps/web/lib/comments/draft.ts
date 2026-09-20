// A draft is a convenience, never state that matters: storage can be blocked, full or absent (a private window), so
// every access is wrapped and a failure simply means there is no draft.
const key = (draftKey: string) => `vezta:comment-draft:${draftKey}`;

export function readDraft(draftKey: string): string {
  try {
    return localStorage.getItem(key(draftKey)) ?? "";
  } catch {
    return "";
  }
}

/** An empty draft is removed rather than stored. */
export function writeDraft(draftKey: string, text: string): void {
  try {
    if (text === "") localStorage.removeItem(key(draftKey));
    else localStorage.setItem(key(draftKey), text);
  } catch {
    /* no storage: the draft lasts as long as the box does */
  }
}
