/**
 * MarkdownRenderer — lightweight platform-level markdown renderer.
 *
 * Zero dependencies. Handles the subset of markdown that Claude produces
 * in agent and chat responses:
 *
 *   # / ## / ###     Headings
 *   **bold**          Bold inline text
 *   - / *             Unordered list items
 *   1. 2. 3.          Ordered list items
 *   | col | col |     Tables (with optional separator row)
 *   ---               Horizontal rule
 *   blank line        Paragraph break
 *
 * Usage:
 *   import MarkdownRenderer from '../components/MarkdownRenderer';
 *   <MarkdownRenderer content={text} />
 *
 * All agent UIs and Chat that display LLM text output should use this component.
 * Formatting improvements here apply everywhere automatically.
 */

/**
 * Parse inline markup within a single line of text.
 * Handles **bold**. Returns an array of strings and React elements.
 */
function parseInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part || null;
  });
}

/** Split a markdown table row into trimmed cell strings. */
function parseTableRow(row) {
  return row.split('|').slice(1, -1).map(c => c.trim());
}

/** Return true if every cell in a row is a separator (dashes / colons). */
function isTableSeparator(row) {
  return parseTableRow(row).every(c => /^[\s:-]+$/.test(c));
}

/**
 * Parse raw markdown text into an array of typed block objects.
 */
function parseBlocks(content) {
  const lines  = content.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();

    // Headings
    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4).trim() });
      i++;

    } else if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3).trim() });
      i++;

    } else if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', text: line.slice(2).trim() });
      i++;

    // Horizontal rule
    } else if (trim === '---' || trim === '***' || trim === '___') {
      blocks.push({ type: 'hr' });
      i++;

    // Table — consecutive lines starting with '|'
    } else if (trim.startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        const headers  = parseTableRow(tableLines[0]);
        const dataRows = tableLines
          .slice(1)
          .filter(row => !isTableSeparator(row))
          .map(parseTableRow);
        if (headers.length > 0) {
          blocks.push({ type: 'table', headers, rows: dataRows });
        }
      }

    // Unordered list — collect consecutive bullet lines
    } else if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: 'ul', items });

    // Ordered list — collect consecutive numbered lines
    } else if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });

    // Empty line — skip
    } else if (trim === '') {
      i++;

    // Paragraph — accumulate until a blank line or block-level element
    } else {
      const textLines = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !lines[i].startsWith('#') &&
        !/^[-*] /.test(lines[i]) &&
        !/^\d+\. /.test(lines[i]) &&
        !lines[i].trim().startsWith('|') &&
        !/^(---|___|\*\*\*)$/.test(lines[i].trim())
      ) {
        textLines.push(lines[i]);
        i++;
      }
      if (textLines.length > 0) {
        blocks.push({ type: 'p', text: textLines.join(' ') });
      } else {
        // Guard: no condition matched and inner loop exited without advancing i.
        // Skip the line to prevent an infinite loop on unrecognised input.
        i++;
      }
    }
  }

  return blocks;
}

// ─── Shared style tokens ───────────────────────────────────────────────────────

const HEADING = { color: 'var(--color-text)', fontFamily: 'var(--font-heading)' };
const TEXT    = { color: 'var(--color-text)' };

// ─── Component ────────────────────────────────────────────────────────────────

export default function MarkdownRenderer({ content, className = '' }) {
  if (!content) return null;

  const blocks = parseBlocks(content);

  return (
    <div className={`text-sm leading-relaxed ${className}`}>
      {blocks.map((block, i) => {
        switch (block.type) {

          case 'h1':
            return (
              <h1 key={i} className="text-xl font-bold mt-6 mb-2 first:mt-0" style={HEADING}>
                {parseInline(block.text)}
              </h1>
            );

          case 'h2':
            return (
              <h2 key={i} className="text-lg font-semibold mt-5 mb-2 first:mt-0" style={HEADING}>
                {parseInline(block.text)}
              </h2>
            );

          case 'h3':
            return (
              <h3 key={i} className="text-base font-semibold mt-4 mb-1.5 first:mt-0" style={HEADING}>
                {parseInline(block.text)}
              </h3>
            );

          case 'hr':
            return (
              <hr key={i} className="my-4" style={{ borderColor: 'var(--color-border)' }} />
            );

          case 'table':
            return (
              <div key={i} style={{ overflowX: 'auto', margin: '12px 0' }}>
                <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                      {block.headers.map((h, j) => (
                        <th
                          key={j}
                          className="text-left py-2 px-3 font-semibold"
                          style={{ color: 'var(--color-muted)', whiteSpace: 'nowrap' }}
                        >
                          {parseInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {row.map((cell, k) => (
                          <td key={k} className="py-2 px-3" style={TEXT}>
                            {parseInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'ul':
            return (
              <ul key={i} className="my-2 pl-5 space-y-1" style={{ listStyleType: 'disc', ...TEXT }}>
                {block.items.map((item, j) => (
                  <li key={j}>{parseInline(item)}</li>
                ))}
              </ul>
            );

          case 'ol':
            return (
              <ol key={i} className="my-2 pl-5 space-y-1" style={{ listStyleType: 'decimal', ...TEXT }}>
                {block.items.map((item, j) => (
                  <li key={j}>{parseInline(item)}</li>
                ))}
              </ol>
            );

          case 'p':
            return (
              <p key={i} className="my-2 first:mt-0" style={TEXT}>
                {parseInline(block.text)}
              </p>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}
