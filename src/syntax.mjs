import { requireInput as need } from './errors.mjs';

// A bounded lexical subset, not a Groovy evaluator or universal OpenStep parser.
export function tokenize(text, mode) {
  const out = [];
  const pattern = mode === 'json' ? /[A-Za-z0-9+.-]/ : /[A-Za-z0-9_$./:+-]/;
  const whitespace = mode === 'json' ? /[ \t\r\n]/ : /\s/;
  for (let i = 0; i < text.length;) {
    need(out.length < 60000, 'INPUT_LIMIT', 'Input exceeds the token limit.');
    const c = text[i];
    if (whitespace.test(c)) { i++; continue; }
    if (mode !== 'json' && text.startsWith('//', i)) {
      const end = text.indexOf('\n', i + 2); i = end < 0 ? text.length : end + 1; continue;
    }
    if (mode !== 'json' && text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      need(end >= 0, 'INVALID_SYNTAX', 'Unterminated comment.'); i = end + 2; continue;
    }
    if (c === '"' || (mode !== 'json' && c === "'")) {
      const start = i++;
      let value = '', closed = false;
      while (i < text.length) {
        const ch = text[i++];
        if (ch === c) { closed = true; break; }
        need(ch >= ' ', 'INVALID_SYNTAX', 'Control character in string.');
        if (ch !== '\\') { value += ch; continue; }
        const e = text[i++];
        const escapes = { '"': '"', "'": "'", '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
        if (e === 'u' && mode === 'json') {
          const hex = text.slice(i, i + 4);
          need(/^[0-9a-f]{4}$/i.test(hex), 'INVALID_SYNTAX', 'Invalid string escape.');
          value += String.fromCharCode(parseInt(hex, 16)); i += 4;
        } else {
          need(Object.hasOwn(escapes, e), 'UNSUPPORTED_SYNTAX', 'Unsupported string escape.');
          value += escapes[e];
        }
      }
      need(closed, 'INVALID_SYNTAX', 'Unterminated string.');
      if (mode === 'json') {
        try { value = JSON.parse(text.slice(start, i)); } catch { need(false, 'INVALID_JSON', 'Invalid JSON string.'); }
      }
      out.push({ type: 'string', value, start, end: i }); continue;
    }
    if ('{}()[]=;,:'.includes(c) && !(mode !== 'json' && c === ':')) {
      out.push({ type: c, value: c, start: i, end: i + 1 }); i++; continue;
    }
    const start = i;
    while (i < text.length && pattern.test(text[i])) i++;
    need(i > start, 'UNSUPPORTED_SYNTAX', 'Unsupported syntax in selected file.');
    out.push({ type: 'word', value: text.slice(start, i), start, end: i });
  }
  return out;
}

// Recursive descent enforces full consumption, duplicate-key rejection and depth.
export function parseData(text, mode = 'json') {
  const tokens = tokenize(text, mode); let i = 0;
  const take = type => { need(tokens[i]?.type === type, 'INVALID_SYNTAX', 'Malformed data structure.'); return tokens[i++]; };
  function value(depth) {
    need(depth <= 48, 'INPUT_LIMIT', 'Input exceeds the nesting limit.');
    const token = tokens[i];
    need(token, 'INVALID_SYNTAX', 'Unexpected end of input.');
    if (token.type === '{') {
      i++; const result = Object.create(null);
      while (tokens[i]?.type !== '}') {
        const key = tokens[i++];
        need(key && (key.type === 'string' || (mode !== 'json' && key.type === 'word')), 'INVALID_SYNTAX', 'Invalid dictionary key.');
        need(!Object.hasOwn(result, key.value), 'DUPLICATE_KEY', 'Duplicate dictionary key.');
        take(mode === 'json' ? ':' : '=');
        result[key.value] = value(depth + 1);
        if (mode !== 'json') take(';');
        else if (tokens[i]?.type !== '}') {
          take(','); need(tokens[i]?.type !== '}', 'INVALID_SYNTAX', 'Trailing comma in JSON.');
        }
      }
      i++; return result;
    }
    const open = mode === 'json' ? '[' : '(';
    const close = mode === 'json' ? ']' : ')';
    if (token.type === open) {
      i++; const result = [];
      while (tokens[i]?.type !== close) {
        result.push(value(depth + 1));
        if (tokens[i]?.type !== close) {
          take(',');
          if (mode === 'json') need(tokens[i]?.type !== close, 'INVALID_SYNTAX', 'Trailing comma in JSON.');
        }
      }
      i++; return result;
    }
    i++;
    need(token.type === 'string' || token.type === 'word', 'INVALID_SYNTAX', 'Invalid data value.');
    if (mode !== 'json' || token.type === 'string') return token.value;
    try {
      const result = JSON.parse(token.value);
      need(result === null || typeof result === 'number' || typeof result === 'boolean', 'INVALID_JSON', 'Invalid JSON value.');
      need(typeof result !== 'number' || Number.isFinite(result), 'INVALID_JSON', 'Non-finite JSON number.');
      return result;
    } catch { need(false, 'INVALID_JSON', 'Invalid JSON value.'); }
  }
  const result = value(0);
  need(i === tokens.length, 'INVALID_SYNTAX', 'Trailing content in selected file.');
  return result;
}
