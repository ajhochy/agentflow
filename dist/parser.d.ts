import type { Token, ASTWorkflow } from './types.js';
export declare class ParseError extends Error {
    line: number;
    col: number;
    constructor(message: string, line: number, col: number);
}
export declare class Parser {
    private tokens;
    private pos;
    constructor(tokens: Token[]);
    private peek;
    private advance;
    private expect;
    private match;
    private skipNewlines;
    parse(): ASTWorkflow;
    private parseAgent;
    private parsePhase;
    private parseLoop;
    private parseBlock;
    private parseProperty;
    private parseListItem;
    private lookahead;
    private parseBlockOrDashList;
    private parseBlockContent;
    private parseExpression;
    private parseAtom;
    private parseInlineList;
}
export declare function parse(source: string): ASTWorkflow;
