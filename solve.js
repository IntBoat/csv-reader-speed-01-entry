// Fast csv-reader 1.0.0-compatible CSV reader.
//
// Written from the task description in the competition kit (RULES.txt): one
// left-to-right pass over the text, same answers {columns, rows, errors} as
// csv-reader 1.0.0, including its broken-row policy (BOM drop, stray CR,
// quote junk, unterminated quotes, short/long rows, line counting).
//
// Speed comes from never building a field one character at a time: unquoted
// fields are sliced out of the input in one piece (stray CRs aside), and
// quoted fields jump from quote to quote with indexOf, slicing each span
// whole. Only spans that actually hold a line break pay for per-character
// work, and only to count lines and fold CR/CRLF to LF.

const COMMA = 44; // ,
const QUOTE = 34; // "
const LF = 10; // \n
const CR = 13; // \r
const BOM = 0xfeff;

/** How a field ended. */
const END_COMMA = 0;
const END_BREAK = 1;
const END_EOF = 2;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === BOM ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Errors of a field or record carry these.
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, how many characters the
  // read itself kept. Shared locals, so no array is built per field.
  let fValue = '';
  let fEnded = END_EOF;
  let fAdded = 0;

  // Reads an unquoted field from pos, starting with `prefix` already kept
  // (only non-empty when re-reading after an unterminated quote, or reading
  // the junk after a closing quote). Sets fValue, fEnded and fAdded, where
  // fAdded counts the characters this read kept.
  function readUnquoted(prefix) {
    let value = prefix;
    let added = 0;
    let seg = pos;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === COMMA) {
        value += text.slice(seg, pos);
        added += pos - seg;
        pos += 1;
        fValue = value;
        fEnded = END_COMMA;
        fAdded = added;
        return;
      }
      if (c === LF) {
        value += text.slice(seg, pos);
        added += pos - seg;
        pos += 1;
        line += 1;
        fValue = value;
        fEnded = END_BREAK;
        fAdded = added;
        return;
      }
      if (c === CR) {
        if (text.charCodeAt(pos + 1) === LF) {
          value += text.slice(seg, pos);
          added += pos - seg;
          pos += 2;
          line += 1;
          fValue = value;
          fEnded = END_BREAK;
          fAdded = added;
          return;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        value += text.slice(seg, pos);
        added += pos - seg;
        pos += 1;
        seg = pos;
        continue;
      }
      pos += 1;
    }
    value += text.slice(seg, pos);
    added += pos - seg;
    fValue = value;
    fEnded = END_EOF;
    fAdded = added;
  }

  // Counts the line breaks in text[s, e): every LF, every CR (a CRLF counts
  // once), and folds every CR and CRLF in the span to one LF in the value.
  // Returns the folded span, or the plain slice when the span holds no break.
  function foldSpan(s, e) {
    const nl = text.indexOf('\n', s);
    const cr = text.indexOf('\r', s);
    if ((nl === -1 || nl >= e) && (cr === -1 || cr >= e)) return text.slice(s, e);
    let out = '';
    let segStart = s;
    for (let i = s; i < e; i++) {
      const c = text.charCodeAt(i);
      if (c === CR) {
        out += text.slice(segStart, i);
        out += '\n';
        line += 1;
        i += text.charCodeAt(i + 1) === LF ? 1 : 0;
        segStart = i + 1;
      } else if (c === LF) {
        out += text.slice(segStart, i);
        out += '\n';
        line += 1;
        segStart = i + 1;
      }
    }
    out += text.slice(segStart, e);
    return out;
  }

  // Reads a quoted field whose opening quote is at pos.
  // Sets fValue, fEnded and fAdded like readUnquoted.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = '';
    let built = false; // true once value holds more than one span
    let segStart = pos;
    while (true) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      if (text.charCodeAt(q + 1) === QUOTE) {
        // A doubled quote: one quote in the value, keep scanning.
        const span = foldSpan(segStart, q);
        value = built ? value + span + '"' : span + '"';
        built = true;
        pos = q + 2;
        segStart = pos;
        continue;
      }
      // The closing quote.
      const span = foldSpan(segStart, q);
      value = built ? value + span : span;
      pos = q + 1;
      break;
    }
    if (pos >= n) {
      fValue = value;
      fEnded = END_EOF;
      fAdded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === COMMA) {
      pos += 1;
      fValue = value;
      fEnded = END_COMMA;
      fAdded = 0;
      return;
    }
    if (c === LF) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = END_BREAK;
      fAdded = 0;
      return;
    }
    if (c === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = END_BREAK;
      fAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      if (text.charCodeAt(pos) === QUOTE) {
        quoted = true;
        readQuoted();
      } else {
        quoted = false;
        readUnquoted('');
      }
      fields.push(fValue);
    } while (fEnded === END_COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
