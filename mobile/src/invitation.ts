/**
 * Pure utilities for cleaning, formatting, and validating invitation codes.
 */

export function cleanInvitationInput(raw: string): string {
  if (!raw) return '';
  let cleaned = raw.trim();

  // Strip enclosing quotes
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Strip email/label prefixes like "user@domain.com: CODE" or "Invitation code: CODE"
  if (cleaned.includes(': ')) {
    const parts = cleaned.split(': ');
    cleaned = parts[parts.length - 1].trim();
  } else if (cleaned.includes(':') && !cleaned.startsWith('http')) {
    const parts = cleaned.split(':');
    cleaned = parts[parts.length - 1].trim();
  }

  // Strip common label prefixes
  const lower = cleaned.toLowerCase();
  for (const prefix of ['invitation code', 'invite code', 'code', 'token']) {
    if (lower.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length).replace(/^[\s:=#\-]+/, '').trim();
      break;
    }
  }

  if (cleaned.startsWith('#')) {
    cleaned = cleaned.slice(1).trim();
  }

  return cleaned;
}

export function isShortInviteCode(value: string): boolean {
  const cleaned = cleanInvitationInput(value).replace(/[\s-]/g, '');
  return /^[A-Z0-9]{6,10}$/i.test(cleaned);
}
