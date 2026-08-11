import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Regression guard for executeClientWebMapLayerQueries merge logic:
 * each command replaces datasetResults; accounting follows the latest query.
 */
function mergeClientWebMapQueryResults(queryRuns) {
  const datasetResults = [];
  let lastAccounting = null;

  for (const querySpec of queryRuns) {
    const executed = querySpec;
    datasetResults.length = 0;
    datasetResults.push(executed.datasetResult);
    if (executed.accounting) lastAccounting = executed.accounting;
  }

  return {
    datasetResults,
    resultAccounting: lastAccounting
      || datasetResults.find((entry) => entry.resultAccounting)?.resultAccounting
      || null
  };
}

test('mergeClientWebMapQueryResults does not retain prior dataset accounting', () => {
  const merged = mergeClientWebMapQueryResults([
    {
      datasetResult: { resultAccounting: { totalMatchingObjectIds: 6 } },
      accounting: { totalMatchingObjectIds: 6, complete: true }
    },
    {
      datasetResult: { resultAccounting: { totalMatchingObjectIds: 19 } },
      accounting: { totalMatchingObjectIds: 19, complete: true }
    }
  ]);

  assert.equal(merged.resultAccounting.totalMatchingObjectIds, 19);
  assert.equal(merged.datasetResults.length, 1);
});
