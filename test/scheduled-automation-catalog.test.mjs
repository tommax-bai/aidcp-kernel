// aidcp:test-owner=derived
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEDULED_AUTOMATION_ACTIONS,
  SCHEDULED_AUTOMATION_CATALOG,
  SCHEDULED_AUTOMATION_CATALOG_READER,
  availableScheduledAutomationActionsForPlatform,
  scheduledAutomationDeclarationsForPlatform,
} from '../dist/kernel/scheduled-automation-catalog.js';
import {
  isSyncReadFactPayload,
  makeSyncReadFactEnvelope,
} from '../dist/kernel/sync-read-facts.js';

const PLATFORMS = ['xiaohongshu', 'facebook', 'wechat_channels'];
const ACTIONS = ['post', 'comment', 'contact_comment', 'join_group'];

test('scheduled automation catalog is closed over every platform and action', () => {
  assert.deepEqual(Object.keys(SCHEDULED_AUTOMATION_CATALOG), PLATFORMS);
  assert.deepEqual(SCHEDULED_AUTOMATION_ACTIONS, ACTIONS);

  for (const platform of PLATFORMS) {
    assert.deepEqual(Object.keys(SCHEDULED_AUTOMATION_CATALOG[platform]), ACTIONS);
    for (const action of ACTIONS) {
      const support = SCHEDULED_AUTOMATION_CATALOG[platform][action];
      if (support.supported) {
        assert.ok(support.maxDailyCap > 0);
        if (action === 'join_group') assert.deepEqual(support.allowedModes, []);
        else assert.ok(support.allowedModes.length > 0);
      } else {
        assert.ok(support.reason.length > 0);
      }
    }
  }
});

test('three reader methods preserve aliases, ordering, honesty, and detached values', () => {
  assert.equal(SCHEDULED_AUTOMATION_CATALOG_READER.normalizeForCatalog('fb'), 'facebook');
  assert.equal(SCHEDULED_AUTOMATION_CATALOG_READER.normalizeForCatalog(' Future-Platform '), 'future-platform');
  assert.deepEqual(availableScheduledAutomationActionsForPlatform('fb'), [
    { action: 'post', allowedModes: ['review'], maxDailyCap: 50 },
    { action: 'comment', allowedModes: ['review', 'auto_approve'], maxDailyCap: 50 },
    { action: 'contact_comment', allowedModes: ['review', 'auto_approve'], maxDailyCap: 10 },
    { action: 'join_group', allowedModes: [], maxDailyCap: 50 },
  ]);
  assert.deepEqual(SCHEDULED_AUTOMATION_CATALOG_READER.availableActions('wechat_channels'), []);
  assert.deepEqual(SCHEDULED_AUTOMATION_CATALOG_READER.availableActions('future-platform'), []);
  assert.equal(SCHEDULED_AUTOMATION_CATALOG_READER.declarationsFor('future-platform'), null);

  const actions = availableScheduledAutomationActionsForPlatform('xiaohongshu');
  actions[0].allowedModes.splice(0);
  const declarations = scheduledAutomationDeclarationsForPlatform('xiaohongshu');
  declarations.post.allowedModes.splice(0);
  assert.deepEqual(SCHEDULED_AUTOMATION_CATALOG.xiaohongshu.post, {
    supported: true,
    allowedModes: ['review', 'auto_approve'],
    maxDailyCap: 50,
  });
});

test('sync-read fact contracts are exported and reject malformed gate payloads', () => {
  const presence = {
    edgeCount: 0,
    onlineEdgeCount: 0,
    accountEdges: [],
  };
  assert.equal(isSyncReadFactPayload('edge_presence', presence), true);
  assert.equal(
    isSyncReadFactPayload('edge_presence', {
      ...presence,
      edgeCount: 0.5,
    }),
    false,
  );
  assert.equal(
    isSyncReadFactPayload('content_schedule', {
      global: null,
      accounts: [{ accountId: 'a', autoEnabled: true }],
    }),
    false,
  );
  assert.equal(
    isSyncReadFactPayload('automation_config_mirror_health', {
      sourceService: 'automation',
      asOf: 1,
      enabled: true,
      pollMs: 5_000,
      entries: [{ mirrorKey: 'broken' }],
    }),
    false,
  );
  assert.deepEqual(
    makeSyncReadFactEnvelope({
      executionTarget: 'dev',
      stream: 'edge_presence',
      cursor: '1',
      asOf: 10,
      freshUntil: 20,
      value: presence,
    }),
    {
      contractVersion: 1,
      executionTarget: 'dev',
      factScope: 'target',
      stream: 'edge_presence',
      cursor: '1',
      asOf: 10,
      freshUntil: 20,
      complete: true,
      value: presence,
    },
  );
});
