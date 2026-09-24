"use client";

import { Sparkles } from "lucide-react";
import type { DeletePlan, EchoNote } from "@/lib/types";
import styles from "./ai-delete-assistant.module.css";

export interface DeleteOutcome {
  deletedIds: string[];
  failed: { id: string; message: string }[];
}

interface AiDeleteAssistantProps {
  notes: EchoNote[];
  disabled?: boolean;
  preview?: boolean;
  onPlan?: (command: string) => Promise<DeletePlan>;
  onDelete?: (notes: EchoNote[]) => Promise<DeleteOutcome>;
}

/** The AI deletion flow is intentionally unavailable until its service is connected. */
export function AiDeleteAssistant(_props: AiDeleteAssistantProps) {
  return <button
    className={`${styles.trigger} ${styles.unavailable}`}
    type="button"
    disabled
    aria-disabled="true"
    title="AI 清理暂未实现"
  >
    <Sparkles size={15} aria-hidden="true" />
    <span>AI 清理（暂未实现）</span>
  </button>;
}
