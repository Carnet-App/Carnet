// Putting a place on a day: the parts of the day, how long each kind of place usually takes,
// and the first free time in a part of the day given what's already planned.
import { span } from './schedule.js';

export const PARTS = [
  { key: 'morning', label: 'Morning', from: 9 * 60, to: 12 * 60 },
  { key: 'afternoon', label: 'Afternoon', from: 12 * 60 + 30, to: 18 * 60 },
  { key: 'evening', label: 'Evening', from: 19 * 60, to: 24 * 60 },
];
const LENGTH = { coffee: 45, eat: 90, drink: 90, dance: 180, culture: 120, explore: 90, other: 90 };
export const lengthFor = (category) => LENGTH[category] || 90;

const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const roundUp = (m, step = 15) => Math.ceil(m / step) * step;

// What's planned on a day (timed items only), as spans in minutes.
export function busyOn(items, day) {
  return items.filter((i) => i.day === day && i.start_time && i.status !== 'cancelled').map((i) => ({ ...span(i), title: i.title, id: i.id })).sort((a, b) => a.start - b.start);
}

// The first start time in that part of the day where `minutes` fits between what's planned.
// If that part is full, the next free time after it, flagged so the screen can say so.
export function freeSlot(items, day, partKey, minutes = 90, skipId = null) {
  const part = PARTS.find((p) => p.key === partKey) || PARTS[0];
  const busy = busyOn(items, day).filter((b) => b.id !== skipId);
  let t = part.from;
  for (const b of busy) {
    if (b.end <= t) continue;
    if (b.start >= t + minutes) break;
    t = roundUp(b.end + 15); // a little time to get there
  }
  const fits = t + minutes <= part.to + 60;
  return { time: hhmm(t), fits };
}

// One line about that part of the day, to see before adding: what's there, or that it's free.
export function partSummary(items, day, partKey) {
  const part = PARTS.find((p) => p.key === partKey) || PARTS[0];
  const there = busyOn(items, day).filter((b) => b.start < part.to && b.end > part.from);
  if (!there.length) return 'nothing planned yet';
  return there.map((b) => `${b.title} at ${hhmm(b.start)}`).join(', ');
}
