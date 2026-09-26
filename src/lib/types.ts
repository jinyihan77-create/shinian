export const SOURCE_TYPES = ["播客", "文章", "书籍", "视频", "生活", "其他"] as const;
export type SourceType = typeof SOURCE_TYPES[number];
export type AiStatus = "not_started" | "processing" | "done" | "error" | "outdated";
export type ThoughtCategory = "idea" | "task" | "goal" | "reference" | "question";
export type TicketPool = "inbox" | "one_time" | "recurring" | "waiting" | "archive";
export type TicketResistance = "low" | "medium" | "high";
export type TicketCadence = "none" | "daily" | "weekly" | "monthly";
export interface TicketSuggestion {
  title: string;
  nextStep: string;
  durationMinutes: 5 | 10 | 20 | 30 | 45 | 60;
  tags: string[];
  resistance: TicketResistance;
}
export interface TicketAnalysis {
  category: ThoughtCategory;
  pool: TicketPool;
  confidence: number;
  rationale: string;
  durationMinutes: 5 | 10 | 20 | 30 | 45 | 60;
  cadence: TicketCadence;
  cadenceReason: string;
  tags: string[];
  prerequisite: string | null;
  resistance: TicketResistance;
  duplicateIds: string[];
  suggestions: TicketSuggestion[];
}
export interface AiResult {
  title: string;
  thoughtSummary: string;
  sourceSummary: string | null;
  keyPoints: { text: string; origin: "用户记录" | "来源片段" }[];
  tags: string[];
  reflectionQuestions: string[];
  possibleApplication: string | null;
  /** Analysis is a recommendation only. It never changes task state by itself. */
  analysis?: TicketAnalysis | null;
  actionItem?: {
    title: string;
    nextStep: string;
  } | null;
}
export interface CaptureInput {
  userText: string;
  sourceType: SourceType;
  sourceName: string;
  sourceUrl: string;
  sourceTimestamp: string;
  sourceExcerpt: string;
}
export interface SourceIntakeRequest {
  transcript: string;
  currentSourceType: SourceType;
}
export interface SourceIntakeResult {
  sourceType: SourceType | null;
  sourceName: string | null;
  sourceTimestamp: string | null;
  sourceExcerpt: string | null;
}
export interface ReflectionRefineRequest {
  id: string;
  version: number;
  text: string;
}
export interface ReflectionRefineResult {
  lines: [string, string, string];
}
export interface DeletePlanMatch {
  id: string;
  reason: string;
}
export interface DeletePlan {
  interpretation: string;
  matches: DeletePlanMatch[];
}
export interface EchoNote extends CaptureInput {
  id: string;
  title: string;
  tags: string[];
  aiStatus: AiStatus;
  aiResult: AiResult | null;
  aiInputRevision: number | null;
  aiError: string | null;
  reflectionPrompt: string;
  reflectionText: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  isExample: boolean;
  storageVersion?: number;
}
export interface Backup {
  schemaVersion: 1;
  exportedAt: string;
  notes: EchoNote[];
}
export const DEFAULT_QUESTION = "如果讲给朋友听，你会怎么解释这条想法？";
export const emptyCapture = (sourceType: SourceType = "播客"): CaptureInput => ({
  userText: "", sourceType, sourceName: "", sourceUrl: "", sourceTimestamp: "", sourceExcerpt: "",
});
export interface AiRequest extends CaptureInput { id: string; revision: number }
export interface AiServiceStatus {
  configured: boolean;
  available: boolean;
  requiresUnlock: boolean;
  message: string;
}
export interface PrivateSession {
  configured: boolean;
  authenticated: boolean;
  user: { id: string; email: string } | null;
  message: string;
  confirmationRequired?: boolean;
}
