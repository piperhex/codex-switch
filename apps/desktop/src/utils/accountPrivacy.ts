const VISIBLE_EMAIL_EDGE_LENGTH = 5;
const MASKED_EMAIL = "*****";

export function maskAccountEmail(email: string) {
  if (email.length <= VISIBLE_EMAIL_EDGE_LENGTH * 2) return MASKED_EMAIL;
  return `${email.slice(0, VISIBLE_EMAIL_EDGE_LENGTH)}${MASKED_EMAIL}${email.slice(-VISIBLE_EMAIL_EDGE_LENGTH)}`;
}
