import type { WorkflowIR, ValidationResult, ValidationIssue } from './types.js';

export function validate(ir: WorkflowIR): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const { agents, phases, loop } = ir.workflow;

  // S1: phase.agent must exist in agents
  for (const phase of phases) {
    if (phase.agent && !agents[phase.agent]) {
      errors.push({
        rule: 'S1',
        message: `Phase "${phase.id}" references undefined agent "${phase.agent}".`,
        phase: phase.id,
      });
    }
  }

  // S2: every output declared in phase.output must be in agent's must_produce
  for (const phase of phases) {
    if (phase.output && phase.agent && agents[phase.agent]) {
      const agent = agents[phase.agent];
      const produces = new Set(agent.must_produce?.map((m) => m.name) ?? []);
      for (const out of phase.output) {
        if (!produces.has(out)) {
          errors.push({
            rule: 'S2',
            message: `Output "${out}" of phase "${phase.id}" is not in must_produce of agent "${phase.agent}".`,
            phase: phase.id,
            agent: phase.agent,
          });
        }
      }
    }
  }

  // S3: every phase referenced in loop.phases must exist in phases
  if (loop) {
    const phaseIds = new Set(phases.map((p) => p.id));
    for (const loopPhaseId of loop.phases) {
      if (!phaseIds.has(loopPhaseId)) {
        errors.push({
          rule: 'S3',
          message: `Loop "${loop.id}" references phase "${loopPhaseId}" which does not exist.`,
        });
      }
    }
  }

  // S4: agent without must_produce — warning
  for (const [agentId, agent] of Object.entries(agents)) {
    if (!agent.must_produce || agent.must_produce.length === 0) {
      warnings.push({
        rule: 'S4',
        message: `Agent "${agentId}" has no must_produce — outputs will not be validated at runtime.`,
        agent: agentId,
      });
    }
  }

  // S5: loop without max_iterations (or max_iterations <= 0)
  if (loop) {
    if (!loop.max_iterations || loop.max_iterations <= 0) {
      errors.push({
        rule: 'S5',
        message: `Loop "${loop.id}" has no max_iterations or has a value <= 0.`,
      });
    }
  }

  // S6: must_produce['confidence'] must be of type float
  for (const [agentId, agent] of Object.entries(agents)) {
    if (agent.must_produce) {
      const confidenceItem = agent.must_produce.find((m) => m.name === 'confidence');
      if (confidenceItem && confidenceItem.type && confidenceItem.type !== 'float') {
        errors.push({
          rule: 'S6',
          message: `Agent "${agentId}" has must_produce "confidence" with type "${confidenceItem.type}" but it must be "float".`,
          agent: agentId,
        });
      }
    }
  }

  // S7: adversarial agent with constraint containing 'agree' or 'approve'
  for (const [agentId, agent] of Object.entries(agents)) {
    if (agent.mode === 'adversarial' && agent.constraints) {
      for (const constraint of agent.constraints) {
        const lower = constraint.toLowerCase();
        if (lower.includes('agree') || lower.includes('approve')) {
          warnings.push({
            rule: 'S7',
            message: `Adversarial agent "${agentId}" has a constraint with 'agree' or 'approve' — may conflict with its role.`,
            agent: agentId,
          });
        }
      }
    }
  }

  // S8: like S7 but for phases — check constraints of the agent used by the phase
  for (const phase of phases) {
    if (phase.agent && agents[phase.agent]) {
      const agent = agents[phase.agent];
      if (agent.mode === 'adversarial' && agent.constraints) {
        for (const constraint of agent.constraints) {
          const lower = constraint.toLowerCase();
          if (lower.includes('agree') || lower.includes('approve')) {
            warnings.push({
              rule: 'S8',
              message: `Phase "${phase.id}" uses adversarial agent "${phase.agent}" with a suspicious constraint.`,
              phase: phase.id,
            });
          }
        }
      }
    }
  }

  // S9: human_action_required phase without timeout
  for (const phase of phases) {
    if (phase.type === 'human_action_required' && !phase.timeout) {
      errors.push({
        rule: 'S9',
        message: `Phase "${phase.id}" is of type "human_action_required" but has no timeout.`,
        phase: phase.id,
      });
    }
  }

  // S10: phase with both poll and retry
  for (const phase of phases) {
    if (phase.poll && phase.retry) {
      errors.push({
        rule: 'S10',
        message: `Phase "${phase.id}" has both poll and retry — this is not allowed.`,
        phase: phase.id,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
