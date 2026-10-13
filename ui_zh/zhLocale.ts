import dictionary from './zhDictionary.json';

const messages: Record<string, string> = dictionary;

/** Translate only rendered values, preserving every value used in trading requests. */
export function zhDisplay<T>(value: T): T | string {
  if (value === true) return '是';
  if (value === false) return '否';
  if (typeof value !== 'string') return value;
  if (Object.hasOwn(messages, value)) return messages[value]!;
  return value;
}

export const zhTableColumn = {
  cell: ({ getValue }: { getValue: () => unknown }) => {
    const value = getValue();
    return value == null ? '' : String(zhDisplay(value));
  },
};
