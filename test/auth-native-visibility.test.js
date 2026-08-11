import test from 'node:test';
import assert from 'node:assert/strict';

function buildAuthNativeVisibilityRestoreStack(layer) {
  const stack = [];
  let current = layer;
  while (current) {
    stack.push({ layer: current, visible: Boolean(current.visible) });
    current = current.parent;
  }
  return stack;
}

function restoreAuthNativeVisibilityState(stack) {
  for (const entry of stack) {
    entry.layer.visible = entry.visible;
  }
}

test('visibility restore stack captures layer and parent states', () => {
  const parent = { id: 'group', visible: false, parent: null };
  const child = { id: 'amenities', visible: false, parent };
  const stack = buildAuthNativeVisibilityRestoreStack(child);
  assert.equal(stack.length, 2);
  assert.equal(stack[0].visible, false);
  assert.equal(stack[1].visible, false);

  for (const entry of stack) entry.layer.visible = true;
  assert.equal(child.visible, true);
  assert.equal(parent.visible, true);

  restoreAuthNativeVisibilityState(stack);
  assert.equal(child.visible, false);
  assert.equal(parent.visible, false);
});
