// "Needs review" of the Agent card: checks answered below the policy confidence (escalated typed questions)
// and panels whose extraction was rejected. Human answers apply at once through the API and are logged with
// source "human". The list is derived from the questions the card fetched and the panels' review state.
import { useState } from 'react';
import type { Panel, Question } from '../../types/index.ts';
import { Actions, Btn } from '../../ui/index.ts';
import { answerText, pct } from './agent-state.ts';

export interface ReviewHandlers {
  busy: boolean;
  canRun: boolean;
  panelName: (id: string) => string;
  show: (panelId: string, q?: Question) => void;
  answer: (q: Question, value: unknown) => void;
  review: (panelId: string, status: 'accepted' | 'rejected') => void;
  remove: (panelId: string) => void;
  redo: (panelId: string, note: string) => void;
}

function DeleteButton({ panelId, h }: { panelId: string; h: ReviewHandlers }) {
  return (
    <Btn
      variant="danger"
      disabled={h.busy}
      title="Delete this panel and its extraction (undo restores it)"
      onClick={() => h.remove(panelId)}
    >
      Delete panel
    </Btn>
  );
}

function GridSizeAnswer({ q, h }: { q: Question; h: ReviewHandlers }) {
  const init = (q.escalated?.answer || q.suggested) as { rows: number; cols: number };
  const [rows, setRows] = useState(String(init.rows));
  const [cols, setCols] = useState(String(init.cols));
  return (
    <>
      <input
        type="number"
        min={1}
        className="num"
        title="Rows"
        value={rows}
        onChange={(e) => setRows(e.target.value)}
      />
      ×
      <input
        type="number"
        min={1}
        className="num"
        title="Columns"
        value={cols}
        onChange={(e) => setCols(e.target.value)}
      />
      <Btn onClick={() => h.answer(q, { rows: Number(rows), cols: Number(cols) })}>Apply</Btn>
    </>
  );
}

function QuestionItem({ q, h }: { q: Question; h: ReviewHandlers }) {
  const esc = q.escalated!;
  const on = (v: boolean) => (v ? true : undefined);
  return (
    <li>
      <div>{`${h.panelName(q.panelId)}: ${q.prompt}`}</div>
      <div className="hint">{`${esc.source || 'An agent'} suggested ${answerText(esc.answer)} (${pct(esc.confidence)} sure)`}</div>
      <Actions>
        <Btn variant="subtle" onClick={() => h.show(q.panelId, q)}>
          Show
        </Btn>
        {q.type === 'confirm_grid_size' ? (
          <GridSizeAnswer q={q} h={h} />
        ) : q.type === 'confirm_extraction' ? (
          // A review of the panel as it is now, so it also works after the values changed since the question
          // was asked. Reject keeps the panel to fix or redo; Delete is the hard no.
          <>
            <Btn pressed={on(esc.answer === 'accept')} onClick={() => h.review(q.panelId, 'accepted')}>
              Accept
            </Btn>
            <Btn variant="danger" pressed={on(esc.answer === 'reject')} onClick={() => h.review(q.panelId, 'rejected')}>
              Reject
            </Btn>
            <DeleteButton panelId={q.panelId} h={h} />
          </>
        ) : (
          (q.answerSchema.enum as string[]).map((opt) => (
            <Btn key={opt} pressed={on(opt === esc.answer)} onClick={() => h.answer(q, opt)}>
              {opt.replaceAll('_', ' ')}
            </Btn>
          ))
        )}
      </Actions>
    </li>
  );
}

function RejectedItem({ panel, h }: { panel: Panel; h: ReviewHandlers }) {
  const rv = panel.review!;
  const [note, setNote] = useState(rv.note || '');
  return (
    <li className="rejected">
      <div>
        {`${panel.name} was rejected${rv.by ? ` by ${rv.by}` : ''}${rv.by !== 'human' && Number.isFinite(rv.confidence) ? ` (${pct(rv.confidence)} sure)` : ''}. Fix it by hand, or let the agent redo it.`}
      </div>
      <input
        type="text"
        spellCheck={false}
        placeholder="What is wrong? (optional, passed to the agent)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          panel.review!.note = note.trim();
        }}
      />
      <Actions>
        <Btn variant="subtle" onClick={() => h.show(panel.id)}>
          Show
        </Btn>
        <Btn variant="primary" disabled={h.busy || !h.canRun} onClick={() => h.redo(panel.id, note.trim())}>
          Redo with agent
        </Btn>
        <Btn onClick={() => h.review(panel.id, 'accepted')}>Accept anyway</Btn>
        <DeleteButton panelId={panel.id} h={h} />
      </Actions>
    </li>
  );
}

export function ReviewList({
  questions,
  rejected,
  h,
}: {
  questions: Question[];
  rejected: Panel[];
  h: ReviewHandlers;
}) {
  return (
    <div id="agent-review" className="agent-review" hidden={!questions.length && !rejected.length}>
      <h3>Needs review</h3>
      <ul id="agent-review-list">
        {rejected.map((p) => (
          <RejectedItem key={`${p.id}:${p.review?.resultHash}`} panel={p} h={h} />
        ))}
        {questions.map((q) => (
          <QuestionItem key={q.id} q={q} h={h} />
        ))}
      </ul>
    </div>
  );
}
