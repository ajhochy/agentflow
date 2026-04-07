const KEYWORDS = new Set([
    'workflow', 'agent', 'phase', 'loop', 'agents', 'phases', 'trigger', 'context',
    'environment', 'when', 'mode', 'model', 'tools', 'must_produce', 'processes',
    'parallel', 'inject_context', 'fail_fast', 'constraint', 'rule', 'input',
    'output', 'type', 'on_fail', 'rollback_on_fail', 'poll', 'retry', 'timeout',
    'on_max_wait_exceeded', 'on_all_failed', 'on_timeout', 'on_max_exceeded',
    'on_each_iteration', 'on_success', 'repeat_while', 'max_iterations', 'done',
    'done_when', 'escalate_to', 'notify', 'notify_user', 'rollback', 'description',
    'version', 'interval', 'backoff', 'max_wait', 'condition', 'max_attempts',
    'delete_files', 'undo', 'send_to', 'payload', 'message', 'attach', 'action',
    'priority', 'then', 'reschedule', 'instruction_to_user', 'data', 'format',
    'completes_when', 'filter', 'event', 'to', 'priority_order', 'log_to',
    'on_event', 'input_schema',
]);
const OPERATORS = ['==', '!=', '>=', '<=', '>', '<'];
export function tokenize(source) {
    const tokens = [];
    const lines = source.split('\n');
    const indentStack = [0];
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const rawLine = lines[lineIdx];
        const lineNum = lineIdx + 1;
        // Skip completely empty lines and comment-only lines
        const trimmed = rawLine.trim();
        if (trimmed === '' || trimmed.startsWith('//')) {
            continue;
        }
        // Calculate indentation
        let indent = 0;
        while (indent < rawLine.length && rawLine[indent] === ' ') {
            indent++;
        }
        // Handle indent/dedent
        const currentIndent = indentStack[indentStack.length - 1];
        if (indent > currentIndent) {
            indentStack.push(indent);
            tokens.push({ kind: 'INDENT', value: '', line: lineNum, col: 1 });
        }
        else if (indent < currentIndent) {
            while (indentStack.length > 1 && indentStack[indentStack.length - 1] > indent) {
                indentStack.pop();
                tokens.push({ kind: 'DEDENT', value: '', line: lineNum, col: 1 });
            }
        }
        else if (tokens.length > 0) {
            // Same level — emit NEWLINE to separate statements
            const lastToken = tokens[tokens.length - 1];
            if (lastToken.kind !== 'INDENT' && lastToken.kind !== 'DEDENT' && lastToken.kind !== 'NEWLINE') {
                tokens.push({ kind: 'NEWLINE', value: '', line: lineNum, col: 1 });
            }
        }
        // Tokenize the line content
        let col = indent;
        const line = rawLine;
        while (col < line.length) {
            const ch = line[col];
            // Skip whitespace
            if (ch === ' ' || ch === '\t') {
                col++;
                continue;
            }
            // Comment — skip rest of line
            if (ch === '/' && col + 1 < line.length && line[col + 1] === '/') {
                break;
            }
            // String literal
            if (ch === '"') {
                let str = '';
                col++; // skip opening quote
                while (col < line.length && line[col] !== '"') {
                    if (line[col] === '\\' && col + 1 < line.length) {
                        const next = line[col + 1];
                        if (next === '"') {
                            str += '"';
                            col += 2;
                        }
                        else if (next === '\\') {
                            str += '\\';
                            col += 2;
                        }
                        else if (next === 'n') {
                            str += '\n';
                            col += 2;
                        }
                        else {
                            str += line[col];
                            col++;
                        }
                    }
                    else {
                        str += line[col];
                        col++;
                    }
                }
                col++; // skip closing quote
                tokens.push({ kind: 'STRING', value: str, line: lineNum, col: col });
                continue;
            }
            // Numbers (possibly followed by duration suffix like s, min, h, d)
            if (ch >= '0' && ch <= '9') {
                let num = '';
                const startCol = col;
                while (col < line.length && ((line[col] >= '0' && line[col] <= '9') || line[col] === '.')) {
                    num += line[col];
                    col++;
                }
                // Check for duration suffix immediately after number (no space)
                if (col < line.length && isIdentStart(line[col])) {
                    let suffix = '';
                    const suffixStart = col;
                    while (col < line.length && isIdentChar(line[col])) {
                        suffix += line[col];
                        col++;
                    }
                    if (suffix === 's' || suffix === 'min' || suffix === 'h' || suffix === 'd') {
                        // Emit as a single IDENTIFIER token representing a duration: "30s", "5min", etc.
                        tokens.push({ kind: 'IDENTIFIER', value: num + suffix, line: lineNum, col: startCol + 1 });
                    }
                    else {
                        // Not a duration — emit number and identifier separately
                        tokens.push({ kind: 'NUMBER', value: num, line: lineNum, col: startCol + 1 });
                        // Check if the suffix is a keyword or special
                        if (suffix === 'true' || suffix === 'false') {
                            tokens.push({ kind: 'BOOL', value: suffix, line: lineNum, col: suffixStart + 1 });
                        }
                        else if (suffix === 'and') {
                            tokens.push({ kind: 'AND', value: suffix, line: lineNum, col: suffixStart + 1 });
                        }
                        else if (suffix === 'or') {
                            tokens.push({ kind: 'OR', value: suffix, line: lineNum, col: suffixStart + 1 });
                        }
                        else if (KEYWORDS.has(suffix)) {
                            tokens.push({ kind: 'KEYWORD', value: suffix, line: lineNum, col: suffixStart + 1 });
                        }
                        else {
                            tokens.push({ kind: 'IDENTIFIER', value: suffix, line: lineNum, col: suffixStart + 1 });
                        }
                    }
                }
                else {
                    tokens.push({ kind: 'NUMBER', value: num, line: lineNum, col: startCol + 1 });
                }
                continue;
            }
            // Operators (two-char first)
            if ((ch === '=' || ch === '!' || ch === '>' || ch === '<') && col + 1 < line.length && line[col + 1] === '=') {
                const op = ch + '=';
                tokens.push({ kind: 'OPERATOR', value: op, line: lineNum, col: col + 1 });
                col += 2;
                continue;
            }
            if (ch === '>' || ch === '<') {
                tokens.push({ kind: 'OPERATOR', value: ch, line: lineNum, col: col + 1 });
                col++;
                continue;
            }
            // Symbols
            if (ch === ':') {
                tokens.push({ kind: 'COLON', value: ':', line: lineNum, col: col + 1 });
                col++;
                continue;
            }
            if (ch === '[') {
                tokens.push({ kind: 'LBRACKET', value: '[', line: lineNum, col: col + 1 });
                col++;
                continue;
            }
            if (ch === ']') {
                tokens.push({ kind: 'RBRACKET', value: ']', line: lineNum, col: col + 1 });
                col++;
                continue;
            }
            if (ch === '.') {
                tokens.push({ kind: 'DOT', value: '.', line: lineNum, col: col + 1 });
                col++;
                continue;
            }
            if (ch === '|') {
                tokens.push({ kind: 'PIPE', value: '|', line: lineNum, col: col + 1 });
                col++;
                continue;
            }
            if (ch === ',') {
                tokens.push({ kind: 'COMMA', value: ',', line: lineNum, col: col + 1 });
                col++;
                continue;
            }
            if (ch === '-') {
                tokens.push({ kind: 'DASH', value: '-', line: lineNum, col: col + 1 });
                col++;
                continue;
            }
            // Identifiers and keywords
            if (isIdentStart(ch)) {
                let ident = '';
                const startCol = col;
                while (col < line.length && isIdentChar(line[col])) {
                    ident += line[col];
                    col++;
                }
                // Booleans
                if (ident === 'true' || ident === 'false') {
                    tokens.push({ kind: 'BOOL', value: ident, line: lineNum, col: startCol + 1 });
                    continue;
                }
                // Logical operators
                if (ident === 'and') {
                    tokens.push({ kind: 'AND', value: 'and', line: lineNum, col: startCol + 1 });
                    continue;
                }
                if (ident === 'or') {
                    tokens.push({ kind: 'OR', value: 'or', line: lineNum, col: startCol + 1 });
                    continue;
                }
                if (ident === 'not') {
                    tokens.push({ kind: 'NOT', value: 'not', line: lineNum, col: startCol + 1 });
                    continue;
                }
                // Keywords
                if (KEYWORDS.has(ident)) {
                    tokens.push({ kind: 'KEYWORD', value: ident, line: lineNum, col: startCol + 1 });
                    continue;
                }
                // Identifier
                tokens.push({ kind: 'IDENTIFIER', value: ident, line: lineNum, col: startCol + 1 });
                continue;
            }
            // Unknown character — skip
            col++;
        }
    }
    // Emit remaining DEDENTs
    while (indentStack.length > 1) {
        indentStack.pop();
        tokens.push({ kind: 'DEDENT', value: '', line: lines.length, col: 1 });
    }
    tokens.push({ kind: 'EOF', value: '', line: lines.length + 1, col: 1 });
    return tokens;
}
function isIdentStart(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}
function isIdentChar(ch) {
    return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}
