import assert from 'node:assert/strict';
import test from 'node:test';

import { checkPasswordStrength } from '../src/password.ts';

test('checkPasswordStrength identifies weak passwords', () => {
  const short = checkPasswordStrength('abc');
  assert.equal(short.isValid, false);
  assert.equal(short.score, 0);

  const onlyLower = checkPasswordStrength('alllowercase');
  assert.equal(onlyLower.isValid, false);
  assert.equal(onlyLower.criteria.hasUpper, false);
  assert.equal(onlyLower.criteria.hasNumber, false);
});

test('checkPasswordStrength identifies valid and strong passwords', () => {
  const valid = checkPasswordStrength('StrongPass1');
  assert.equal(valid.isValid, true);
  assert.equal(valid.criteria.hasLength, true);
  assert.equal(valid.criteria.hasUpper, true);
  assert.equal(valid.criteria.hasLower, true);
  assert.equal(valid.criteria.hasNumber, true);
  assert.ok(valid.score >= 3);

  const strong = checkPasswordStrength('StrongPass123!');
  assert.equal(strong.isValid, true);
  assert.equal(strong.criteria.hasSpecial, true);
  assert.equal(strong.score, 4);
  assert.equal(strong.label, 'Strong');
});
