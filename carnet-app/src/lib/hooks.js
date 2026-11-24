import { useMemo } from 'react';
import { useStore } from './store';

const vals = (o) => Object.values(o || {});

export function useTrip(tripId, me) {
  const s = useStore();
  return useMemo(() => {
    const trip = s.trips[tripId];
    if (!trip) return { trip: null };
    const by = (t) => vals(s[t]).filter((r) => r.trip_id === tripId);
    const members = by('trip_members').sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : (a.created_at || '').localeCompare(b.created_at || '')));
    const items = by('items').map((it) => {
      const p = s.private_notes[it.id];
      return p ? { ...it, title: p.title || it.title, notes: p.notes ?? it.notes, mine_private: true } : it;
    });
    const mine = members.find((m) => m.email?.toLowerCase() === me);
    const admin = mine ? ['owner', 'admin'].includes(mine.role) : !trip.owner || members.length === 0;
    return {
      trip,
      me,
      myRole: mine?.role || 'member',
      isAdmin: admin,
      canEdit: admin || trip.approval === false,
      proposals: by('proposals').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
      members,
      stays: by('stays'),
      items,
      expenses: by('expenses').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
      settlements: by('settlements'),
      places: vals(s.places).filter((p) => p.city?.toLowerCase() === trip.city?.toLowerCase()),
    };
  }, [s, tripId]);
}

export function useCityPlaces(city) {
  const places = useStore((s) => s.places);
  return useMemo(() => vals(places).filter((p) => p.city?.toLowerCase() === city?.toLowerCase()), [places, city]);
}
