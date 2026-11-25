export const db = new Map();
export const get = async (k) => db.get(k);
export const set = async (k, v) => { db.set(k, v); };
