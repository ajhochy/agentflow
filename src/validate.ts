import type { WorkflowIR, ValidationResult, ValidationIssue } from './types.js';

export function validate(ir: WorkflowIR): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const { agents, phases, loop } = ir.workflow;

  // S1: phase.agent deve esistere in agents
  for (const phase of phases) {
    if (phase.agent && !agents[phase.agent]) {
      errors.push({
        rule: 'S1',
        message: `La fase "${phase.id}" usa l'agente "${phase.agent}" non definito.`,
        phase: phase.id,
      });
    }
  }

  // S2: ogni output dichiarato in phase.output deve essere in must_produce dell'agente
  for (const phase of phases) {
    if (phase.output && phase.agent && agents[phase.agent]) {
      const agent = agents[phase.agent];
      const produces = new Set(agent.must_produce?.map((m) => m.name) ?? []);
      for (const out of phase.output) {
        if (!produces.has(out)) {
          errors.push({
            rule: 'S2',
            message: `L'output "${out}" della fase "${phase.id}" non è in must_produce dell'agente "${phase.agent}".`,
            phase: phase.id,
            agent: phase.agent,
          });
        }
      }
    }
  }

  // S3: ogni fase citata in loop.phases deve esistere in phases
  if (loop) {
    const phaseIds = new Set(phases.map((p) => p.id));
    for (const loopPhaseId of loop.phases) {
      if (!phaseIds.has(loopPhaseId)) {
        errors.push({
          rule: 'S3',
          message: `Il loop "${loop.id}" riferisce la fase "${loopPhaseId}" che non esiste.`,
        });
      }
    }
  }

  // S4: agente senza must_produce — warning
  for (const [agentId, agent] of Object.entries(agents)) {
    if (!agent.must_produce || agent.must_produce.length === 0) {
      warnings.push({
        rule: 'S4',
        message: `L'agente "${agentId}" non ha must_produce — output non validati a runtime.`,
        agent: agentId,
      });
    }
  }

  // S5: loop senza max_iterations (o max_iterations <= 0)
  if (loop) {
    if (!loop.max_iterations || loop.max_iterations <= 0) {
      errors.push({
        rule: 'S5',
        message: `Il loop "${loop.id}" non ha max_iterations o ha un valore <= 0.`,
      });
    }
  }

  // S6: must_produce['confidence'] deve essere tipo float
  for (const [agentId, agent] of Object.entries(agents)) {
    if (agent.must_produce) {
      const confidenceItem = agent.must_produce.find((m) => m.name === 'confidence');
      if (confidenceItem && confidenceItem.type && confidenceItem.type !== 'float') {
        errors.push({
          rule: 'S6',
          message: `L'agente "${agentId}" ha must_produce "confidence" con tipo "${confidenceItem.type}" ma deve essere "float".`,
          agent: agentId,
        });
      }
    }
  }

  // S7: agente adversarial con constraint che contiene 'agree' o 'approve'
  for (const [agentId, agent] of Object.entries(agents)) {
    if (agent.mode === 'adversarial' && agent.constraints) {
      for (const constraint of agent.constraints) {
        const lower = constraint.toLowerCase();
        if (lower.includes('agree') || lower.includes('approve')) {
          warnings.push({
            rule: 'S7',
            message: `L'agente adversarial "${agentId}" ha un constraint con 'agree' o 'approve' — potrebbe contraddire il suo ruolo.`,
            agent: agentId,
          });
        }
      }
    }
  }

  // S8: come S7 ma per fase — controlla constraint dell'agente usato dalla fase
  for (const phase of phases) {
    if (phase.agent && agents[phase.agent]) {
      const agent = agents[phase.agent];
      if (agent.mode === 'adversarial' && agent.constraints) {
        for (const constraint of agent.constraints) {
          const lower = constraint.toLowerCase();
          if (lower.includes('agree') || lower.includes('approve')) {
            warnings.push({
              rule: 'S8',
              message: `La fase "${phase.id}" usa l'agente adversarial "${phase.agent}" con constraint sospetto.`,
              phase: phase.id,
            });
          }
        }
      }
    }
  }

  // S9: fase human_action_required senza timeout
  for (const phase of phases) {
    if (phase.type === 'human_action_required' && !phase.timeout) {
      errors.push({
        rule: 'S9',
        message: `La fase "${phase.id}" è di tipo "human_action_required" ma non ha timeout.`,
        phase: phase.id,
      });
    }
  }

  // S10: fase con sia poll che retry
  for (const phase of phases) {
    if (phase.poll && phase.retry) {
      errors.push({
        rule: 'S10',
        message: `La fase "${phase.id}" ha sia poll che retry — non è consentito.`,
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
