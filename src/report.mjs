export function report(scope, checks, issues, notes) {
  checks.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const incomplete = issues.length > 0 || checks.length === 0 || checks.some(item => item.status === 'unsupported');
  const exitCode = incomplete ? 2 : checks.some(item => item.status === 'drift') ? 1 : 0;
  return { schemaVersion: 1, scope, coverage: incomplete ? 'incomplete' : 'complete-for-selected-declarations', outcome: ['match', 'drift', 'incomplete'][exitCode], exitCode, checks, issues, notes };
}
export function formatText(result) {
  const title = ['Selected declaration checks match.', 'Selected declaration checks found drift.', 'Selected declaration audit is incomplete.'][result.exitCode];
  const lines = [title, `Coverage: ${result.coverage}`, `Scope: ${JSON.stringify(result.scope)}`];
  for (const item of result.checks) lines.push(`${item.status.toUpperCase()} ${item.id}${Object.hasOwn(item, 'expected') ? ` expected=${JSON.stringify(item.expected)} actual=${JSON.stringify(item.actual)}` : ''}`);
  for (const issue of result.issues) lines.push(`UNSUPPORTED ${issue.id}: ${issue.message}`);
  for (const note of result.notes) lines.push(`NOTE ${note}`);
  return lines.join('\n') + '\n';
}
