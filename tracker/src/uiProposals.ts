// The window's routes for proposed week plans and the week's aims, under /v1/ui/.
// ui.ts has already checked the cookie and header before these run.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, send } from './api.ts';
import type { GoalResult, Journal } from './journal.ts';
import type { Proposal } from './weekPlan.ts';
import { blockTimes, checkChoice, compareDay } from './weekPlan.ts';

/** Your job's hours on a day, as ms, or null on a day off. */
export type JobFor = (day: string) => { start: number; end: number } | null;

/** A proposal with each day held up against what's planned for it now. */
export function proposalView(journal: Journal, proposal: Proposal, jobFor: JobFor) {
  return {
    ...proposal,
    days: proposal.days.map((d) => {
      const current = journal.planBlocks(d.day);
      const compared = compareDay(d.day, current, d.blocks);
      return {
        ...d,
        blocks: d.blocks.map((b, i) => ({ ...b, ...blockTimes(d.day, b.start, b.end), was: compared.was[i] ?? null, same: compared.same[i] ?? false })),
        current: current.length,
        removed: compared.removed.map((r) => ({ label: r.label, start: r.start, end: r.end })),
        goals: journal.goals(d.day).length,
        job: jobFor(d.day),
      };
    }),
  };
}

function result(value: unknown): GoalResult | null {
  if (value === null) return null;
  if (value !== 'met' && value !== 'partly' && value !== 'missed') throw new HttpError(400, 'result must be met, partly, missed, or null');
  return value;
}

export async function proposalRoutes(
  journal: Journal,
  method: string,
  route: string,
  request: IncomingMessage,
  response: ServerResponse,
  today: string,
  now: number,
  jobFor: JobFor,
): Promise<boolean> {
  let m: RegExpExecArray | null;

  if (method === 'GET' && route === '/proposals') {
    const waiting = journal.waitingProposals(today);
    const ids = new Set(waiting.map((p) => p.id));
    const history = journal
      .proposals(12)
      .filter((p) => !ids.has(p.id) && p.status !== 'replaced')
      .map((p) => ({ id: p.id, week: p.week, status: p.status, createdAt: p.createdAt, decidedAt: p.decidedAt, days: p.days.length, taken: p.choice?.days.length ?? 0 }));
    send(response, 200, { waiting: waiting.map((p) => proposalView(journal, p, jobFor)), history, today });
    return true;
  }
  if ((m = /^\/proposals\/(\d+)$/.exec(route)) && method === 'GET') {
    const proposal = journal.proposal(Number(m[1]));
    if (!proposal) throw new HttpError(404, 'no such proposal');
    send(response, 200, proposalView(journal, proposal, jobFor));
    return true;
  }
  if ((m = /^\/proposals\/(\d+)\/apply$/.exec(route)) && method === 'POST') {
    const proposal = journal.proposal(Number(m[1]));
    if (!proposal) throw new HttpError(404, 'no such proposal');
    if (proposal.status !== 'waiting') throw new HttpError(409, `this proposal was already ${proposal.status}`);
    const choice = checkChoice(await readJson(request), proposal);
    if (typeof choice === 'string') throw new HttpError(400, choice);
    const applied = journal.applyProposal(proposal.id, choice, now);
    if (!applied) throw new HttpError(409, 'this proposal is no longer waiting');
    const { proposal: _p, ...counts } = applied;
    send(response, 200, counts);
    return true;
  }
  if ((m = /^\/proposals\/(\d+)\/discard$/.exec(route)) && method === 'POST') {
    const discarded = journal.discardProposal(Number(m[1]), now);
    if (!discarded) throw new HttpError(409, 'this proposal is no longer waiting');
    send(response, 204);
    return true;
  }

  if ((m = /^\/week-aims\/(\d+)$/.exec(route))) {
    if (method === 'PATCH') {
      const body = (await readJson(request)) as Record<string, unknown>;
      const aim = journal.updateWeekAim(Number(m[1]), { result: result(body['result']) });
      if (!aim) throw new HttpError(404, 'no such aim');
      send(response, 200, aim);
      return true;
    }
    if (method === 'DELETE') {
      send(response, journal.deleteWeekAim(Number(m[1])) ? 204 : 404);
      return true;
    }
  }
  return false;
}
