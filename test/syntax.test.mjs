import test from 'node:test';
import assert from 'node:assert/strict';
import { parseData } from '../src/syntax.mjs';
import { parsePlist } from '../src/readers/xml.mjs';

test('JSON structural limits, malformed forms and escaped duplicate keys', () => {
  for (const input of ['{"x":1,}', '[1,]', '{"a":1,"\\u0061":2}', '[1e999]', '{"x":undefined}', '["bad\\q"]', '['.repeat(50) + '0' + ']'.repeat(50)]) assert.throws(() => parseData(input));
});
test('OpenStep subset rejects trailing content, duplicate keys and unsupported escapes', () => {
  for (const input of ['{ a = 1; } trailing', '{ a = 1; a = 2; }', '{ a = "\\U0041"; }', '{ a = <1234>; }', '{ a = 1; /* unterminated']) assert.throws(() => parseData(input, 'pbx'));
});
test('dictionary prototype keys are inert data', () => {
  const parsed = parseData('{"__proto__":{"polluted":true}}');
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal({}.polluted, undefined);
});
test('XML nesting and custom entity limits', () => {
  assert.throws(() => parsePlist('<plist>' + '<array>'.repeat(50) + '</array>'.repeat(50) + '</plist>'));
  assert.throws(() => parsePlist('<!DOCTYPE plist [<!ENTITY x "xxx">]><plist><string>&x;</string></plist>'));
});

test('JSON accepts only its four whitespace characters outside strings', () => {
  assert.equal(parseData(' \t\r\n { "value" : 1 } \t\r\n').value, 1);
  for (const whitespace of ['\u000b', '\u000c', '\u00a0', '\u2028', '\u2029']) {
    for (const input of [`${whitespace}{"value":1}`, `{"value":${whitespace}1}`, `{"value":1}${whitespace}`]) {
      assert.throws(() => JSON.parse(input));
      assert.throws(() => parseData(input));
    }
    // These characters are data inside a quoted string, not structural whitespace.
    assert.equal(parseData(JSON.stringify({ value: whitespace })).value, whitespace);
  }
});

test('plist root permits whitespace/comments but rejects stray text and CDATA', () => {
  const value = '<dict><key>example</key><string>value</string></dict>';
  assert.equal(parsePlist(`<plist version="1.0"> \t\r\n<!-- comment -->${value}\n</plist>`).example, 'value');
  for (const content of ['garbage', '<![CDATA[garbage]]>', '\u00a0']) {
    assert.throws(() => parsePlist(`<plist version="1.0">${content}${value}</plist>`), { code: 'INVALID_PLIST' });
    assert.throws(() => parsePlist(`<plist version="1.0">${value}${content}</plist>`), { code: 'INVALID_PLIST' });
  }
});
