export class InputError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function requireInput(condition, code, message) {
  if (!condition) throw new InputError(code, message);
}
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
