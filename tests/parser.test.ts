import { parse } from '../src/parser.js';
import type { ASTWorkflow, ASTCondition, ASTRef, ASTBlock, ASTList } from '../src/types.js';

describe('Parser', () => {
  test('parsa "workflow foo" → ASTWorkflow { id: "foo" }', () => {
    const ast = parse('workflow foo');
    expect(ast.kind).toBe('workflow');
    expect(ast.id).toBe('foo');
  });

  test('parsa workflow con description e version', () => {
    const source = `workflow test_flow
  description: "A test workflow"
  version: "1.0.0"`;
    const ast = parse(source);
    expect(ast.id).toBe('test_flow');
    expect(ast.properties.length).toBe(2);
    expect(ast.properties[0].key).toBe('description');
    expect(ast.properties[0].value).toEqual({ kind: 'literal', value: 'A test workflow', rawType: 'string' });
    expect(ast.properties[1].key).toBe('version');
  });

  test('parsa agent con must_produce lista', () => {
    const source = `workflow test
  agents:
    agent writer
      model: "claude-sonnet"
      mode: focused
      must_produce:
        - code
        - tests`;
    const ast = parse(source);
    expect(ast.agents.length).toBe(1);
    expect(ast.agents[0].id).toBe('writer');
    const modeProp = ast.agents[0].properties.find(p => p.key === 'model');
    expect(modeProp).toBeDefined();

    const mpProp = ast.agents[0].properties.find(p => p.key === 'must_produce');
    expect(mpProp).toBeDefined();
    expect(mpProp!.value.kind).toBe('list');
    const list = mpProp!.value as ASTList;
    expect(list.items.length).toBe(2);
  });

  test('parsa ref "review.verdict" → ASTRef { path: "review.verdict" }', () => {
    const source = `workflow test
  done when: review.verdict == "approved"`;
    const ast = parse(source);
    const doneWhen = ast.properties.find(p => p.key === 'done_when');
    expect(doneWhen).toBeDefined();
    const cond = doneWhen!.value as ASTCondition;
    expect(cond.kind).toBe('condition');
    expect(cond.left.kind).toBe('ref');
    expect((cond.left as ASTRef).path).toBe('review.verdict');
  });

  test('parsa condizione "review.confidence >= 0.85" → ASTCondition con op ">="', () => {
    const source = `workflow test
  done when: review.confidence >= 0.85`;
    const ast = parse(source);
    const doneWhen = ast.properties.find(p => p.key === 'done_when');
    const cond = doneWhen!.value as ASTCondition;
    expect(cond.kind).toBe('condition');
    expect(cond.op).toBe('>=');
    expect((cond.left as ASTRef).path).toBe('review.confidence');
    expect(cond.right).toEqual({ kind: 'literal', value: 0.85, rawType: 'number' });
  });

  test('parsa "done when: cond" → ASTProperty { key: "done_when" }', () => {
    const source = `workflow test
  done when: review.verdict == "approved"`;
    const ast = parse(source);
    const prop = ast.properties.find(p => p.key === 'done_when');
    expect(prop).toBeDefined();
    expect(prop!.kind).toBe('property');
    expect(prop!.key).toBe('done_when');
  });

  test('parsa agent con tools inline list', () => {
    const source = `workflow test
  agents:
    agent validator
      tools: [dns_lookup, whois_check]`;
    const ast = parse(source);
    const agent = ast.agents[0];
    const toolsProp = agent.properties.find(p => p.key === 'tools');
    expect(toolsProp).toBeDefined();
    expect(toolsProp!.value.kind).toBe('list');
    const list = toolsProp!.value as ASTList;
    expect(list.items.length).toBe(2);
  });

  test('parsa phase con retry block', () => {
    const source = `workflow test
  phases:
    phase provision
      agent: ssl_provisioner
      retry:
        max_attempts: 3
        backoff: 30s`;
    const ast = parse(source);
    const phase = ast.phases[0];
    expect(phase.id).toBe('provision');
    const retryProp = phase.properties.find(p => p.key === 'retry');
    expect(retryProp).toBeDefined();
    expect(retryProp!.value.kind).toBe('block');
    const block = retryProp!.value as ASTBlock;
    const maxAttempts = block.properties.find(p => p.key === 'max_attempts');
    expect(maxAttempts).toBeDefined();
  });

  test('parsa loop', () => {
    const source = `workflow test
  loop quality_gate
    phases: [write, test, review]
    repeat_while: review.verdict == "needs_work"
    max_iterations: 5`;
    const ast = parse(source);
    expect(ast.loop).toBeDefined();
    expect(ast.loop!.id).toBe('quality_gate');
    const phasesProp = ast.loop!.properties.find(p => p.key === 'phases');
    expect(phasesProp).toBeDefined();
  });

  test('parsa condizione composta con and', () => {
    const source = `workflow test
  done when: review.confidence >= 0.85 and review.verdict == "approved"`;
    const ast = parse(source);
    const doneWhen = ast.properties.find(p => p.key === 'done_when');
    expect(doneWhen).toBeDefined();
    const cond = doneWhen!.value as ASTCondition;
    expect(cond.kind).toBe('condition');
    // The compound condition should have logic 'and'
    expect(cond.logic).toBe('and');
  });

  test('parsa must_produce con tipo', () => {
    const source = `workflow test
  agents:
    agent critic
      must_produce:
        - verdict
        - confidence: float`;
    const ast = parse(source);
    const agent = ast.agents[0];
    const mpProp = agent.properties.find(p => p.key === 'must_produce');
    expect(mpProp).toBeDefined();
    const list = mpProp!.value as ASTList;
    expect(list.items.length).toBe(2);
    // Second item should be a block with key-value
    expect(list.items[1].kind).toBe('block');
    const block = list.items[1] as ASTBlock;
    expect(block.properties[0].key).toBe('confidence');
  });
});
