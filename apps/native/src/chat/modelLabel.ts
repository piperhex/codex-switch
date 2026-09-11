const MAX_MODEL_LABEL_CHARACTERS = 20;

/** Keep the identifying suffix of long provider and aggregate model labels. */
export function modelLabelTail(label: string): string {
  const characters = Array.from(label);
  return characters.length > MAX_MODEL_LABEL_CHARACTERS
    ? `...${characters.slice(-MAX_MODEL_LABEL_CHARACTERS).join('')}` : label;
}
