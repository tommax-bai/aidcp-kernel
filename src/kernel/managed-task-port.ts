/**
 * Phase-one managed-task cross-owner contract.
 *
 * API authenticates actors and account scope; Automation owns admission, persistence,
 * execution, and projections. This file contains only DTOs and ports: no SQL, HTTP,
 * Edge dispatch, timers, or process-local state.
 */
import type { DeploymentTarget } from '../deployment-target.js';
import type { PlatformId } from './platform-types.js';

export const MANAGED_TASK_CONTRACT = {
  name: 'managed-task',
  version: 1,
} as const;

export type ManagedTaskJsonPrimitive = string | number | boolean | null;
export type ManagedTaskJson =
  | ManagedTaskJsonPrimitive
  | ManagedTaskJson[]
  | { [key: string]: ManagedTaskJson };

export interface ManagedTaskActor {
  kind: 'customer' | 'operator' | 'agent';
  actorId: string;
  customerId: string;
  authorizationRevision: string;
}

export interface ManagedTaskEnvelope<T> {
  contract: typeof MANAGED_TASK_CONTRACT;
  executionTarget: DeploymentTarget;
  correlationId: string;
  causationId: string | null;
  input: T;
}

export interface CreateManagedTaskInput {
  commandId: string;
  payloadHash: string;
  actor: ManagedTaskActor;
  accountId: string;
  envKey: string;
  platform: PlatformId;
  taskDefinition: {
    id: string;
    version: number;
  };
  parameters: ManagedTaskJson;
  capabilityScope: {
    allow: string[];
    deny: string[];
  };
  budget: {
    maxBrowserMinutes: number;
    maxSteps: number;
    maxExecutionAttempts: number;
    maxWaitMs: number;
  };
  schedule: {
    scheduledAt: number;
    latestStartAt: number;
    missPolicy: 'skip' | 'execute_when_available';
  };
}

export interface CancelManagedTaskInput {
  commandId: string;
  payloadHash: string;
  actor: ManagedTaskActor;
  accountId: string;
  taskId: string;
  expectedAggregateVersion: number;
  reason: string;
}

export interface QueryManagedTaskInput {
  requestId: string;
  actor: ManagedTaskActor;
  accountId: string;
  taskId: string;
}

export type ManagedTaskRejectionCode =
  | 'account_not_authorized'
  | 'capability_scope_denied'
  | 'contract_invalid'
  | 'execution_target_mismatch'
  | 'feature_disabled'
  | 'idempotency_collision'
  | 'invalid_task_request'
  | 'platform_write_not_supported'
  | 'protocol_version_mismatch'
  | 'schema_not_ready'
  | 'unsupported';

export interface ManagedTaskRejection {
  outcome: 'rejected';
  code: ManagedTaskRejectionCode;
  message: string;
}

export interface ManagedTaskUnavailable {
  outcome: 'unavailable';
  reason: string;
}

export interface ManagedTaskResultUnknown {
  outcome: 'result_unknown';
  commandId: string;
  lookupRequired: true;
}

export interface ManagedTaskAppliedReceipt {
  outcome: 'applied' | 'duplicate';
  commandId: string;
  taskId: string;
  runId: string | null;
  aggregateVersion: number;
}

export interface ManagedTaskCollisionReceipt {
  outcome: 'collision';
  commandId: string;
}

export type CreateManagedTaskResult =
  | ManagedTaskAppliedReceipt
  | ManagedTaskCollisionReceipt
  | ManagedTaskRejection
  | ManagedTaskUnavailable
  | ManagedTaskResultUnknown;

export interface CancelManagedTaskReceipt {
  outcome: 'applied' | 'duplicate';
  commandId: string;
  taskId: string;
  aggregateVersion: number;
  dispatchedAttemptReconciliationContinues: boolean;
}

export type CancelManagedTaskResult =
  | CancelManagedTaskReceipt
  | ManagedTaskCollisionReceipt
  | ManagedTaskRejection
  | ManagedTaskUnavailable
  | ManagedTaskResultUnknown;

export type ManagedTaskProjectionState =
  | 'queued'
  | 'waiting_for_lane'
  | 'waiting'
  | 'running'
  | 'cancelled'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'submitted_unknown'
  | 'unsupported'
  | 'attention_required';

export interface ManagedTaskProjection {
  taskId: string;
  accountId: string;
  taskDefinitionId: string;
  taskDefinitionVersion: number;
  state: ManagedTaskProjectionState;
  reasonCode: string | null;
  confirmedUnits: number;
  targetUnits: number | null;
  createdAt: number;
  updatedAt: number;
  trace: Array<{
    decisionType: string;
    outcome: string;
    reasonCode: string;
    createdAt: number;
  }>;
}

export type QueryManagedTaskResult =
  | { outcome: 'found'; task: ManagedTaskProjection }
  | { outcome: 'not_found' }
  | ManagedTaskRejection
  | ManagedTaskUnavailable;

export interface ManagedTaskCommandPort {
  create(envelope: ManagedTaskEnvelope<CreateManagedTaskInput>): Promise<CreateManagedTaskResult>;
  cancel(envelope: ManagedTaskEnvelope<CancelManagedTaskInput>): Promise<CancelManagedTaskResult>;
  query(envelope: ManagedTaskEnvelope<QueryManagedTaskInput>): Promise<QueryManagedTaskResult>;
}
