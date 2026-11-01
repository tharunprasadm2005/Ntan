import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanInvitationInput, isShortInviteCode } from '../src/invitation.ts';

test('cleanInvitationInput strips email prefixes from copied team invites', () => {
  assert.equal(
    cleanInvitationInput('user@example.com: NT4A-9K2M'),
    'NT4A-9K2M',
  );
  assert.equal(
    cleanInvitationInput('alex@domain.org: 4F_sH7nQ2x9pL1vM8'),
    '4F_sH7nQ2x9pL1vM8',
  );
});

test('cleanInvitationInput strips label prefixes and whitespace', () => {
  assert.equal(cleanInvitationInput('Invitation code: ABCD-1234'), 'ABCD-1234');
  assert.equal(cleanInvitationInput('Code: #XYZ-9999'), 'XYZ-9999');
  assert.equal(cleanInvitationInput('   "W7X9-K4M2"  '), 'W7X9-K4M2');
});

test('isShortInviteCode recognizes 8-char codes with or without hyphens', () => {
  assert.equal(isShortInviteCode('NT4A-9K2M'), true);
  assert.equal(isShortInviteCode('NT4A9K2M'), true);
  assert.equal(isShortInviteCode('not a valid code'), false);
});
