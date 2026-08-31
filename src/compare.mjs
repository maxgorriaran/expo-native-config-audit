// Pure comparison of normalized declarations. No filesystem or platform imports.
export function compare(expected, actual) {
  const checks = [];
  function add(id, matches, expectedValue, actualValue) {
    const item = { id, status: matches ? 'match' : 'drift' };
    if (expectedValue !== undefined) item.expected = expectedValue;
    if (actualValue !== undefined) item.actual = actualValue;
    checks.push(item);
  }
  for (const platform of Object.keys(expected).sort()) {
    const wanted = expected[platform], found = actual[platform];
    if (!found) { checks.push({ id: `${platform}.coverage`, status: 'unsupported' }); continue; }
    for (const field of ['id', 'version', 'build']) add(`${platform}.${field}`, wanted[field] === found[field], wanted[field], found[field]);
    for (const scheme of wanted.schemes) add(`${platform}.scheme.${scheme}`, found.schemes.includes(scheme), scheme, found.schemes.includes(scheme) ? scheme : null);
    for (const key of Object.keys(wanted.permissions.required).sort()) {
      // Usage-description text is compared but never emitted.
      add(`${platform}.permission.required.${key}`, wanted.permissions.required[key] === found.permissions.required[key]);
    }
    for (const key of wanted.permissions.blocked) add(`${platform}.permission.blocked.${key}`, found.permissions.blocked.includes(key) && !Object.hasOwn(found.permissions.required, key));
  }
  return checks.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
