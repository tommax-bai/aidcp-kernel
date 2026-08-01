import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MANAGED_TASK_CONTRACT,
  type CreateManagedTaskResult,
  type ManagedTaskEnvelope,
  type QueryManagedTaskInput,
} from '../../src/kernel/managed-task-port.js';

describe('managed task port contract', () => {
  it('freezes a distinct versioned contract', () => {
    assert.deepEqual(MANAGED_TASK_CONTRACT, { name: 'managed-task', version: 1 });
  });

  it('keeps target and authorization actor in the typed envelope', () => {
    const envelope: ManagedTaskEnvelope<QueryManagedTaskInput> = {
      contract: MANAGED_TASK_CONTRACT,
      executionTarget: 'dev',
      correlationId: 'correlation-1',
      causationId: null,
      input: {
        requestId: 'request-1',
        actor: {
          kind: 'agent',
          actorId: 'agent-1',
          customerId: 'customer-1',
          authorizationRevision: 'authorization-1',
        },
        accountId: 'account-1',
        taskId: 'task-1',
      },
    };
    assert.equal(envelope.executionTarget, 'dev');
    assert.equal(envelope.input.actor.authorizationRevision, 'authorization-1');
  });

  it('keeps collision and result-unknown distinct from business rejection', () => {
    const results: CreateManagedTaskResult[] = [
      { outcome: 'collision', commandId: 'command-1' },
      { outcome: 'result_unknown', commandId: 'command-2', lookupRequired: true },
      { outcome: 'rejected', code: 'feature_disabled', message: 'disabled' },
    ];
    assert.deepEqual(results.map((result) => result.outcome), [
      'collision', 'result_unknown', 'rejected',
    ]);
  });
});
