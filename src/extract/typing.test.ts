// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { isFormField, isTextEntry } from './typing.ts';

const input = (type: string) => Object.assign(document.createElement('input'), { type });

test('isTextEntry: text fields and selects, not checkboxes, ranges or buttons', () => {
  assert.equal(isTextEntry(input('text')), true);
  assert.equal(isTextEntry(input('number')), true);
  assert.equal(isTextEntry(document.createElement('textarea')), true);
  assert.equal(isTextEntry(document.createElement('select')), true);
  assert.equal(isTextEntry(input('checkbox')), false);
  assert.equal(isTextEntry(input('range')), false);
  assert.equal(isTextEntry(document.createElement('button')), false);
  assert.equal(isTextEntry(window), false);
  assert.equal(isTextEntry(null), false);
});

test('isFormField also counts checkboxes and ranges', () => {
  assert.equal(isFormField(input('checkbox')), true);
  assert.equal(isFormField(input('range')), true);
  assert.equal(isFormField(document.createElement('div')), false);
});
