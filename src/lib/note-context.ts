export const CAPTURE_KINDS = ["thought", "moment", "relationship"] as const;
export type CaptureKind = typeof CAPTURE_KINDS[number];

const MOMENT_TAG = "__shinian_context:moment";
const RELATIONSHIP_TAG = "__shinian_context:relationship";
export const CAPTURE_CONTEXT_TAGS = [MOMENT_TAG, RELATIONSHIP_TAG] as const;

export const isCaptureContextTag = (tag: string) => tag === MOMENT_TAG || tag === RELATIONSHIP_TAG;

export function captureContextTags(kind: CaptureKind): string[] {
  if (kind === "moment") return [MOMENT_TAG];
  if (kind === "relationship") return [MOMENT_TAG, RELATIONSHIP_TAG];
  return [];
}

export function captureKindFromTags(tags: readonly string[]): CaptureKind {
  if (tags.includes(RELATIONSHIP_TAG)) return "relationship";
  if (tags.includes(MOMENT_TAG)) return "moment";
  return "thought";
}

export function isCaptureKind(value: unknown): value is CaptureKind {
  return typeof value === "string" && CAPTURE_KINDS.includes(value as CaptureKind);
}
