// "Been here" and a thumbs up or down: one per person per place, shared with the trip.
import { useStore, upsert, uid } from './store';
import { getMe } from './me';

export function usePlaceRatings(placeId) {
  const all = useStore((s) => s.place_ratings);
  return Object.values(all || {}).filter((r) => r.place_id === placeId);
}
export function useAllRatings() {
  const all = useStore((s) => s.place_ratings);
  const by = new Map();
  for (const r of Object.values(all || {})) { if (!by.has(r.place_id)) by.set(r.place_id, []); by.get(r.place_id).push(r); }
  return by;
}
export const mineOf = (list) => { const me = getMe(); return (list || []).find((r) => (me.id && r.user_id === me.id) || (me.email && r.email === me.email)); };
export function tally(list) {
  let up = 0, down = 0, been = 0;
  for (const r of list || []) { if (r.vote > 0) up++; else if (r.vote < 0) down++; if (r.visited) been++; }
  return { up, down, been };
}
// Change my rating; a thumbs up or down means I've been.
export function rate(place, list, patch, tripId) {
  const me = getMe();
  const mine = mineOf(list);
  const next = { visited: mine?.visited ?? false, vote: mine?.vote ?? 0, ...patch };
  if (patch.vote) next.visited = true;
  if (patch.visited === false) next.vote = 0;
  upsert('place_ratings', { id: mine?.id || uid(), place_id: place.id, trip_id: mine?.trip_id || tripId || null, user_id: me.id, email: me.email, ...next });
  // Your own place also keeps its "visited" flag (older copies of the app read it).
  if (!place.owner || place.owner === me.id) upsert('places', { id: place.id, visited: next.visited });
}
