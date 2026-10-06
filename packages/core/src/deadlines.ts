import type {
  EntityId,
  ISODateTime,
  JsonFieldValue,
} from "./domain.ts";

export const DEADLINE_STATES = [
  "open",
  "paused",
  "completed",
  "cancelled",
] as const;

export type DeadlineState =
  (typeof DEADLINE_STATES)[number];

export interface DeadlineInstance {
  id: EntityId;
  registryId: string;
  recordId: EntityId;
  deadlineTypeId: string;
  instanceKey: string;
  anchorAt: ISODateTime;
  dueAt: ISODateTime;
  state: DeadlineState;
  pausedAt?: ISODateTime;
  totalPausedSeconds: number;
  completedAt?: ISODateTime;
  cancelledAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  metadata?: Record<string, JsonFieldValue>;
}

export type DeadlineUrgency =
  | "cancelled"
  | "completed"
  | "paused"
  | "overdue"
  | "due_soon"
  | "open";
