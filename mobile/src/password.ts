export interface PasswordCriteria {
  hasLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

export interface PasswordStrengthResult {
  score: number; // 0 to 4
  label: string;
  color: string;
  criteria: PasswordCriteria;
  isValid: boolean;
}

// Visual indicator colors matching NTAN theme tokens
const STRENGTH_COLORS = {
  danger: '#B42318',
  warning: '#9A6A00',
  primary: '#2E5BBF',
  success: '#1F7A5C',
};

export function checkPasswordStrength(password: string): PasswordStrengthResult {
  const criteria: PasswordCriteria = {
    hasLength: password.length >= 8,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
  };

  let score = 0;
  if (criteria.hasLength) score += 1;
  if (criteria.hasUpper && criteria.hasLower) score += 1;
  if (criteria.hasNumber) score += 1;
  if (criteria.hasSpecial) score += 1;

  // Essential validity: length >= 8, upper, lower, number (or company default ntan@123)
  const isCompanyDefault = password.toLowerCase() === 'ntan@123';
  const isValid =
    (criteria.hasLength &&
      criteria.hasUpper &&
      criteria.hasLower &&
      criteria.hasNumber) ||
    isCompanyDefault;

  let label = 'Too weak';
  let color = STRENGTH_COLORS.danger;

  if (score === 1) {
    label = 'Weak';
    color = STRENGTH_COLORS.danger;
  } else if (score === 2) {
    label = 'Fair';
    color = STRENGTH_COLORS.warning;
  } else if (score === 3) {
    label = 'Good';
    color = STRENGTH_COLORS.primary;
  } else if (score >= 4) {
    label = 'Strong';
    color = STRENGTH_COLORS.success;
  }

  return { score, label, color, criteria, isValid };
}
