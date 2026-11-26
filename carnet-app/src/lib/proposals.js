// The master schedule: admins change it directly; everyone else proposes.
import { upsert, patch, remove, uid, failedJobs, dropFailed } from './store';
import { notify } from './push';
import { dayLabel, hm, nameOf } from './util';

const FIELDS = ['title', 'category', 'day', 'start_time', 'end_time', 'status', 'place_id', 'lat', 'lng', 'address', 'booking_ref', 'qr_text', 'attachment_path', 'tickets', 'photos', 'alternatives', 'notes', 'visibility'];
const onSchedule = (r) => r && r.visibility === 'shared' && !!r.day;

// Does saving this need an admin's OK?
export function needsApproval(t, before, after) {
  if (t.canEdit) return false;
  if (after && after.visibility !== 'shared' && !onSchedule(before)) return false; // your own busy/private time
  return onSchedule(before) || onSchedule(after);
}

const when = (r) => [r.day && dayLabel(r.day), r.start_time && hm(r.start_time)].filter(Boolean).join(' · ');

export function propose(t, kind, before, after) {
  const id = uid();
  const item_id = before?.id || after?.id || uid();
  const payload = after ? Object.fromEntries(FIELDS.filter((k) => k in after).map((k) => [k, after[k] ?? null])) : {};
  const prev = before ? Object.fromEntries(FIELDS.map((k) => [k, before[k] ?? null])) : null;
  upsert('proposals', { id, trip_id: t.trip.id, item_id, kind, payload, before: prev, status: 'pending', proposed_by_email: t.me });
  const who = nameOf(t.members, t.me);
  const what = after?.title || before?.title;
  notify(t.trip.id, {
    adminsOnly: true,
    tag: 'proposal-' + id,
    title: `${who} proposes ${kind === 'remove' ? 'removing' : kind === 'add' ? 'adding' : 'a change to'} ${what}`,
    body: kind === 'remove' ? when(before) : kind === 'change' ? `${when(before)} → ${when({ ...before, ...payload })}` : when(payload) || 'Tap to review',
    url: '/',
  });
  return id;
}

export function decide(t, p, approve, note) {
  if (approve) {
    if (p.kind === 'remove') remove('items', p.item_id);
    else
      upsert('items', {
        ...(p.kind === 'change' ? {} : { visibility: 'shared', status: 'planned' }),
        ...p.payload,
        id: p.item_id,
        trip_id: p.trip_id,
        ...(p.kind === 'add' ? { created_by_email: p.proposed_by_email } : {}),
      });
  }
  patch('proposals', p.id, { status: approve ? 'approved' : 'declined', note: note || null, decided_by_email: t.me, decided_at: new Date().toISOString() });
  const what = p.payload?.title || p.before?.title;
  notify(t.trip.id, {
    onlyEmail: p.proposed_by_email,
    tag: 'proposal-' + p.id,
    title: `${nameOf(t.members, t.me)} ${approve ? 'approved' : 'declined'}: ${what}`,
    body: note || (approve ? 'It’s on the schedule.' : ''),
  });
}

// Edits an admin made while the app wrongly thought they needed approval: the server refused
// the proposal, so the change never happened. Now the app knows better, make the change itself.
export function recoverOwnProposals(t) {
  if (!t?.trip) return 0;
  let n = 0;
  for (const j of failedJobs()) {
    const p = j.table === 'proposals' && j.op === 'upsert' ? j.row : null;
    if (!t.canEdit || !p || p.trip_id !== t.trip.id || p.status !== 'pending' || !p.kind) continue;
    if (p.kind === 'remove') remove('items', p.item_id);
    else upsert('items', { ...(p.kind === 'change' ? {} : { visibility: 'shared', status: 'planned' }), ...p.payload, id: p.item_id, trip_id: p.trip_id });
    remove('proposals', p.id);
    n++;
  }
  if (n) dropFailed((j) => j.table === 'proposals' && j.row?.trip_id === t.trip.id && j.row?.status === 'pending');
  // Approvals, declines and withdrawals refused the same way: send them again as plain updates.
  // (The schedule change of an approval went through on its own; only the proposal's status didn't.)
  const decided = failedJobs().filter((j) => j.table === 'proposals' && j.op === 'upsert' && j.row?.trip_id === t.trip.id && j.row?.status !== 'pending');
  for (const j of decided) {
    const { status, note, decided_by_email, decided_at } = j.row;
    patch('proposals', j.row.id, { status, note: note ?? null, decided_by_email: decided_by_email ?? null, decided_at: decided_at ?? null });
  }
  if (decided.length) dropFailed((j) => decided.includes(j));
  return n + decided.length;
}

export function withdraw(p) {
  patch('proposals', p.id, { status: 'withdrawn' });
}

// Tell everyone when the schedule changes directly.
export function announce(t, before, after) {
  if (!onSchedule(after) && !onSchedule(before)) return;
  const who = nameOf(t.members, t.me);
  notify(t.trip.id, {
    tag: 'item-' + (after?.id || before?.id),
    title: !after ? `${who} removed ${before.title}` : before ? `${who} changed ${after.title}` : `${who} added ${after.title}`,
    body: after ? when(after) : '',
  });
}
