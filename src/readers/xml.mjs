import { DOMParser } from '@xmldom/xmldom';
import { requireInput as need } from '../errors.mjs';

export const children = node => Array.from(node.childNodes ?? []).filter(child => child.nodeType === 1);

export function parseXml(text, kind) {
  // Permit the conventional plist declaration, never fetch it or expand entities.
  const safe = kind === 'plist' ? text.replace(/<!DOCTYPE plist PUBLIC "-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN" "http:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd"\s*>/, '') : text;
  need(!/<!DOCTYPE|<!ENTITY/i.test(safe), 'UNSUPPORTED_XML', 'Custom DTDs and entity declarations are unsupported.');
  let doc;
  try { doc = new DOMParser({ onError: () => { throw new Error('Invalid XML'); } }).parseFromString(safe, 'text/xml'); }
  catch { need(false, 'INVALID_XML', 'Malformed XML.'); }
  let count = 0;
  function visit(node, depth) {
    need(++count <= 30000 && depth <= 48, 'INPUT_LIMIT', 'XML exceeds structural limits.');
    for (const child of Array.from(node.childNodes ?? [])) visit(child, depth + 1);
  }
  visit(doc, 0);
  need(children(doc).length === 1, 'INVALID_XML', 'Expected one XML document element.');
  return doc.documentElement;
}

export function parsePlist(text) {
  const root = parseXml(text, 'plist');
  need(root.tagName === 'plist' && children(root).length === 1, 'INVALID_PLIST', 'Expected an XML plist.');
  function validateContainerText(node) {
    need(Array.from(node.childNodes).every(child => ![3, 4].includes(child.nodeType) || /^[ \t\r\n]*$/.test(child.textContent)), 'INVALID_PLIST', 'Unexpected text in plist container.');
  }
  validateContainerText(root);
  function decode(node) {
    const items = children(node);
    need(node.attributes.length === 0 && !node.namespaceURI, 'UNSUPPORTED_PLIST', 'Attributed or namespaced plist values are unsupported.');
    if (node.tagName === 'dict' || node.tagName === 'array') {
      validateContainerText(node);
    }
    if (node.tagName === 'dict') {
      need(items.length % 2 === 0, 'INVALID_PLIST', 'Unpaired plist dictionary key.');
      const result = Object.create(null);
      for (let i = 0; i < items.length; i += 2) {
        need(items[i].tagName === 'key' && !items[i].namespaceURI && !items[i].attributes.length && !children(items[i]).length, 'INVALID_PLIST', 'Invalid plist dictionary key.');
        const key = items[i].textContent;
        need(!Object.hasOwn(result, key), 'DUPLICATE_KEY', 'Duplicate plist key.');
        result[key] = decode(items[i + 1]);
      }
      return result;
    }
    if (node.tagName === 'array') return items.map(decode);
    need(!items.length, 'INVALID_PLIST', 'Unexpected nested plist element.');
    if (node.tagName === 'string') return node.textContent;
    if (node.tagName === 'true' || node.tagName === 'false') {
      need(node.textContent.trim() === '', 'INVALID_PLIST', 'Malformed plist boolean.'); return node.tagName === 'true';
    }
    if (node.tagName === 'integer') {
      need(/^-?\d+$/.test(node.textContent.trim()) && Number.isSafeInteger(Number(node.textContent)), 'INVALID_PLIST', 'Invalid plist integer.');
      return Number(node.textContent);
    }
    need(false, 'UNSUPPORTED_PLIST', 'Only dict, array, string, integer and boolean plist values are supported.');
  }
  return decode(children(root)[0]);
}
