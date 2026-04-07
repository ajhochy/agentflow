import { tokenize } from './tokenizer.js';
import type {
  Token, TokenKind,
  ASTWorkflow, ASTAgent, ASTPhase, ASTLoop,
  ASTProperty, ASTValue, ASTLiteral, ASTRef, ASTList, ASTBlock, ASTCondition,
} from './types.js';

export class ParseError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(`Parse error at line ${line}, col ${col}: ${message}`);
  }
}

export class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: 'EOF' as TokenKind, value: '', line: 0, col: 0 };
  }

  private advance(): Token {
    const token = this.peek();
    this.pos++;
    return token;
  }

  private expect(kind: TokenKind, value?: string): Token {
    const token = this.peek();
    if (token.kind !== kind || (value !== undefined && token.value !== value)) {
      throw new ParseError(
        `Expected ${kind}${value ? `(${value})` : ''} but got ${token.kind}(${token.value})`,
        token.line, token.col
      );
    }
    return this.advance();
  }

  private match(kind: TokenKind, value?: string): boolean {
    const token = this.peek();
    if (token.kind === kind && (value === undefined || token.value === value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private skipNewlines(): void {
    while (this.peek().kind === 'NEWLINE') {
      this.advance();
    }
  }

  parse(): ASTWorkflow {
    this.skipNewlines();
    this.expect('KEYWORD', 'workflow');
    const id = this.expect('IDENTIFIER').value;

    const properties: ASTProperty[] = [];
    const agents: ASTAgent[] = [];
    const phases: ASTPhase[] = [];
    let loop: ASTLoop | undefined;

    // Expect an indented block for workflow body
    if (this.peek().kind === 'INDENT') {
      this.advance(); // consume INDENT
      this.skipNewlines();

      while (this.peek().kind !== 'DEDENT' && this.peek().kind !== 'EOF') {
        this.skipNewlines();
        if (this.peek().kind === 'DEDENT' || this.peek().kind === 'EOF') break;

        const token = this.peek();

        if (token.kind === 'KEYWORD' && token.value === 'agents') {
          this.advance(); // consume 'agents'
          this.match('COLON');
          if (this.peek().kind === 'INDENT') {
            this.advance();
            this.skipNewlines();
            while (this.peek().kind !== 'DEDENT' && this.peek().kind !== 'EOF') {
              this.skipNewlines();
              if (this.peek().kind === 'DEDENT' || this.peek().kind === 'EOF') break;
              agents.push(this.parseAgent());
              this.skipNewlines();
            }
            if (this.peek().kind === 'DEDENT') this.advance();
          }
        } else if (token.kind === 'KEYWORD' && token.value === 'phases') {
          this.advance(); // consume 'phases'
          this.match('COLON');
          if (this.peek().kind === 'INDENT') {
            this.advance();
            this.skipNewlines();
            while (this.peek().kind !== 'DEDENT' && this.peek().kind !== 'EOF') {
              this.skipNewlines();
              if (this.peek().kind === 'DEDENT' || this.peek().kind === 'EOF') break;
              phases.push(this.parsePhase());
              this.skipNewlines();
            }
            if (this.peek().kind === 'DEDENT') this.advance();
          }
        } else if (token.kind === 'KEYWORD' && token.value === 'loop') {
          loop = this.parseLoop();
        } else if (token.kind === 'KEYWORD' && token.value === 'agent') {
          agents.push(this.parseAgent());
        } else if (token.kind === 'KEYWORD' && token.value === 'phase') {
          phases.push(this.parsePhase());
        } else {
          // Parse as a workflow-level property
          const prop = this.parseProperty();
          if (prop) properties.push(prop);
        }
        this.skipNewlines();
      }
      if (this.peek().kind === 'DEDENT') this.advance();
    }

    return { kind: 'workflow', id, properties, agents, phases, loop };
  }

  private parseAgent(): ASTAgent {
    this.expect('KEYWORD', 'agent');
    const id = this.expect('IDENTIFIER').value;
    const properties = this.parseBlock();
    return { kind: 'agent', id, properties };
  }

  private parsePhase(): ASTPhase {
    this.expect('KEYWORD', 'phase');
    const id = this.expect('IDENTIFIER').value;
    const properties = this.parseBlock();
    return { kind: 'phase', id, properties };
  }

  private parseLoop(): ASTLoop {
    this.expect('KEYWORD', 'loop');
    const id = this.expect('IDENTIFIER').value;
    const properties = this.parseBlock();
    return { kind: 'loop', id, properties };
  }

  private parseBlock(): ASTProperty[] {
    const properties: ASTProperty[] = [];
    if (this.peek().kind !== 'INDENT') return properties;

    this.advance(); // consume INDENT
    this.skipNewlines();

    while (this.peek().kind !== 'DEDENT' && this.peek().kind !== 'EOF') {
      this.skipNewlines();
      if (this.peek().kind === 'DEDENT' || this.peek().kind === 'EOF') break;
      const prop = this.parseProperty();
      if (prop) properties.push(prop);
      this.skipNewlines();
    }
    if (this.peek().kind === 'DEDENT') this.advance();
    return properties;
  }

  private parseProperty(): ASTProperty | null {
    const token = this.peek();

    // Handle "done when:" as special case
    if (token.kind === 'KEYWORD' && token.value === 'done') {
      this.advance();
      if (this.peek().kind === 'KEYWORD' && this.peek().value === 'when') {
        this.advance(); // consume 'when'
        this.expect('COLON');
        const value = this.parseExpression();
        return { kind: 'property', key: 'done_when', value };
      }
      // Just "done" by itself — shouldn't happen, but handle gracefully
      return null;
    }

    // Handle list items: "- value" or "- key: value"
    if (token.kind === 'DASH') {
      return this.parseListItem();
    }

    // Standard property: key: value
    if (token.kind === 'KEYWORD' || token.kind === 'IDENTIFIER') {
      const key = this.advance().value;

      // Handle compound keywords like "on_fail", "rollback_on_fail" that might be blocks
      if (this.peek().kind === 'COLON') {
        this.advance(); // consume ':'

        // Check for indented block
        if (this.peek().kind === 'INDENT') {
          // Could be a block or a list with dashes
          const blockProps = this.parseBlockOrDashList();
          return { kind: 'property', key, value: blockProps };
        }

        // Inline value
        const value = this.parseExpression();
        return { kind: 'property', key, value };
      }

      // No colon — might be an identifier used as value
      return { kind: 'property', key, value: { kind: 'literal', value: key, rawType: 'identifier' } };
    }

    // Skip unexpected tokens
    this.advance();
    return null;
  }

  private parseListItem(): ASTProperty | null {
    this.expect('DASH');
    const token = this.peek();

    if ((token.kind === 'KEYWORD' || token.kind === 'IDENTIFIER') && this.lookahead(1)?.kind === 'COLON') {
      // "- key: value" — typed must_produce item
      const key = this.advance().value;
      this.advance(); // consume ':'
      const value = this.parseAtom();
      return { kind: 'property', key, value };
    }

    // "- value" — simple list item
    const value = this.parseAtom();
    const key = typeof value === 'object' && 'value' in value && value.kind === 'literal'
      ? String(value.value) : '_item';
    return { kind: 'property', key, value };
  }

  private lookahead(offset: number): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private parseBlockOrDashList(): ASTValue {
    // Peek into the block to see if it starts with dashes
    const savedPos = this.pos;
    this.advance(); // consume INDENT
    this.skipNewlines();

    if (this.peek().kind === 'DASH') {
      // It's a dash list — parse items
      const items: ASTValue[] = [];
      while (this.peek().kind !== 'DEDENT' && this.peek().kind !== 'EOF') {
        this.skipNewlines();
        if (this.peek().kind === 'DEDENT' || this.peek().kind === 'EOF') break;
        if (this.peek().kind === 'DASH') {
          this.advance(); // consume '-'
          // Check for "key: type" pattern
          if ((this.peek().kind === 'KEYWORD' || this.peek().kind === 'IDENTIFIER') && this.lookahead(1)?.kind === 'COLON') {
            const key = this.advance().value;
            this.advance(); // consume ':'
            const typeVal = this.parseAtom();
            // Represent as a block with key-value
            items.push({
              kind: 'block',
              properties: [{ kind: 'property', key, value: typeVal }]
            });
          } else {
            items.push(this.parseAtom());
          }
        } else {
          // Non-dash item in list — parse as property within block
          // Actually this might be a nested block, restore and parse as block
          this.pos = savedPos;
          return { kind: 'block', properties: this.parseBlockContent() };
        }
        this.skipNewlines();
      }
      if (this.peek().kind === 'DEDENT') this.advance();
      return { kind: 'list', items };
    }

    // Not a dash list — it's a regular block
    this.pos = savedPos;
    return { kind: 'block', properties: this.parseBlockContent() };
  }

  private parseBlockContent(): ASTProperty[] {
    const properties: ASTProperty[] = [];
    if (this.peek().kind !== 'INDENT') return properties;
    this.advance(); // consume INDENT
    this.skipNewlines();

    while (this.peek().kind !== 'DEDENT' && this.peek().kind !== 'EOF') {
      this.skipNewlines();
      if (this.peek().kind === 'DEDENT' || this.peek().kind === 'EOF') break;
      const prop = this.parseProperty();
      if (prop) properties.push(prop);
      this.skipNewlines();
    }
    if (this.peek().kind === 'DEDENT') this.advance();
    return properties;
  }

  private parseExpression(): ASTValue {
    const left = this.parseAtom();

    // Check for comparison operator
    if (this.peek().kind === 'OPERATOR') {
      const op = this.advance().value;
      const right = this.parseAtom();
      let condition: ASTCondition = { kind: 'condition', left, op, right };

      // Check for 'and' / 'or' chaining
      while (this.peek().kind === 'AND' || this.peek().kind === 'OR') {
        const logic = this.advance().value as 'and' | 'or';
        const nextLeft = this.parseAtom();
        if (this.peek().kind === 'OPERATOR') {
          const nextOp = this.advance().value;
          const nextRight = this.parseAtom();
          const nextCondition: ASTCondition = { kind: 'condition', left: nextLeft, op: nextOp, right: nextRight };
          condition = { kind: 'condition', left: condition as unknown as ASTValue, op: logic, right: nextCondition as unknown as ASTValue, logic };
        } else {
          condition = { kind: 'condition', left: condition as unknown as ASTValue, op: logic, right: nextLeft, logic };
        }
      }

      return condition;
    }

    return left;
  }

  private parseAtom(): ASTValue {
    const token = this.peek();

    // String literal
    if (token.kind === 'STRING') {
      this.advance();
      return { kind: 'literal', value: token.value, rawType: 'string' };
    }

    // Number
    if (token.kind === 'NUMBER') {
      this.advance();
      const num = token.value.includes('.') ? parseFloat(token.value) : parseInt(token.value, 10);
      return { kind: 'literal', value: num, rawType: 'number' };
    }

    // Boolean
    if (token.kind === 'BOOL') {
      this.advance();
      return { kind: 'literal', value: token.value === 'true', rawType: 'bool' };
    }

    // Inline list
    if (token.kind === 'LBRACKET') {
      return this.parseInlineList();
    }

    // Identifier or ref (possibly dotted)
    if (token.kind === 'IDENTIFIER' || token.kind === 'KEYWORD') {
      let path = this.advance().value;

      while (this.peek().kind === 'DOT') {
        this.advance(); // consume '.'
        const next = this.peek();
        if (next.kind === 'IDENTIFIER' || next.kind === 'KEYWORD') {
          path += '.' + this.advance().value;
        } else {
          break;
        }
      }

      // Check if it's a duration like "30s", "5min", "48h", "7d"
      // Already part of the identifier if parsed as one token, otherwise number + unit

      if (path.includes('.')) {
        return { kind: 'ref', path };
      }

      return { kind: 'literal', value: path, rawType: 'identifier' };
    }

    // Fallback
    this.advance();
    return { kind: 'literal', value: token.value, rawType: 'string' };
  }

  private parseInlineList(): ASTList {
    this.expect('LBRACKET');
    const items: ASTValue[] = [];

    while (this.peek().kind !== 'RBRACKET' && this.peek().kind !== 'EOF') {
      this.skipNewlines();
      if (this.peek().kind === 'RBRACKET') break;
      items.push(this.parseAtom());
      if (this.peek().kind === 'COMMA') {
        this.advance();
      }
      this.skipNewlines();
    }
    this.expect('RBRACKET');
    return { kind: 'list', items };
  }
}

export function parse(source: string): ASTWorkflow {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parse();
}
