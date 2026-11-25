// The travel import pipeline without the network: mirrors Capture.jsx fromFiles() and the
// offline part of understand() at commit 991ed65 (candidates per page, nameless quote cards,
// merging across pages). Map lookups are left out on purpose: this measures extraction.
export async function extractTravel(C, canvas) {
  const t0 = Date.now();
  const r = await C.readText(canvas);
  const sheet = C.mapsSheet(r.text);
  if (sheet) {
    const cands = [{ name: sheet.name, weight: 20, why: 'map app · place card' }];
    return { ms: Date.now() - t0, text: r.text, overlay: '', lines: r.lines, post: false, cands, shown: cands, nameless: 0 };
  }
  const post = C.postLayout(r.lines, r.height);
  const first = C.notTheAccount(r.lines?.length ? C.firstLine({ post, lines: r.lines, height: r.height, text: r.text }) : C.venueCandidates(r.text), post?.handle);
  let overlay = { text: '', lines: [] };
  if (post || !C.isStrong(first)) overlay = await C.readOverlay(canvas, post ? post.media : { y0: 0, y1: canvas.height }).catch(() => ({ text: '', lines: [] }));
  const handle = post?.handle || (post?.caption || '').match(/^\s*([a-z0-9._]{3,30})\b/m)?.[1];
  const pic = C.notTheAccount(C.overlayCandidates(overlay.lines, { handle }), handle);
  const cands = C.tieredCandidates(first, pic, r.text);
  // What the review screen can show with no signal: confident candidates (weight >= 4) and nameless quote cards.
  const shown = cands.slice(0, 6).filter((c) => c.weight >= 4).map((c) => ({ name: c.name, weight: c.weight, why: c.why }));
  const nameless = pic.filter((c) => !c.name && !cands.some((x) => x.weight >= 5)).length;
  return { ms: Date.now() - t0, text: r.text, overlay: overlay.text, lines: [...r.lines, ...overlay.lines], post: !!post, cands, shown, nameless };
}

export async function extractReceipt(C, R, canvas) {
  const t0 = Date.now();
  const res = await C.readReceipt(canvas);
  const parsed = R.parseReceipt(res.text);
  return { ms: Date.now() - t0, text: res.text, angle: res.angle, conf: res.conf, parsed };
}
