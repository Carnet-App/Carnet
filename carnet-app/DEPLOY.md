# Carnet — putting it live

You've done DNS (Cloudflare) and created the Supabase project. These are the remaining steps, in order. About 30 minutes.

---

## 1. Database (5 min)

1. Supabase → **SQL Editor** → **New query**.
2. Paste everything in `supabase/setup.sql` → **Run**. It should say *Success. No rows returned*.

That creates the tables, the "who can see what" rules (including hidden and busy items), photo storage, and live sync between phones.

## 2. Emails: Resend (10 min)

Both the sign-in codes and the "join my trip" invites need this.

1. Sign up at **resend.com** → **Domains → Add domain** → `mail.sebwalker.co.uk`.
2. Add the records Resend shows into **Cloudflare → DNS**, all set to **DNS only** (grey cloud). Click **Verify** in Resend.
3. **API Keys → Create API key** (sending access). Copy it and keep it handy for steps 2.4 and 4.
4. Supabase → **Authentication → Emails → SMTP Settings** → **Enable custom SMTP**:
   - Host `smtp.resend.com` · Port `465` · Username `resend` · Password = the Resend key
   - Sender email `trips@mail.sebwalker.co.uk` · Sender name `Carnet`
5. Supabase → **Authentication → Emails → Templates → Magic Link**. Replace the body with:

   ```html
   <h2>Your Carnet code</h2>
   <p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
   <p>Type this into Carnet to sign in. It expires in an hour.</p>
   ```
   Subject: `Your Carnet code`

   **Why a code instead of a link:** a link would open in Safari, not in the home-screen app, so you'd end up signed in to the wrong one.

## 3. Code → GitHub (5 min)

1. Create an empty **private** repo called `carnet` at github.com/new.
2. Unzip `carnet-app.zip`. On the repo page, click **uploading an existing file**, drag in **everything inside** the `carnet-app` folder, and click **Commit**.
   (Or, from Terminal in that folder: `git init && git add . && git commit -m "Carnet" && git branch -M main && git remote add origin https://github.com/YOU/carnet.git && git push -u origin main`.)

## 4. Cloudflare Worker (10 min)

1. Cloudflare → **Workers & Pages → Create → Import a repository** → connect GitHub → choose `carnet`.
2. Build settings:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
3. Deploy. `wrangler.jsonc` already contains:
   - the custom domain **trips.sebwalker.co.uk**, which Cloudflare creates along with its HTTPS certificate
   - the daily Supabase keep-alive
   - the public Supabase URL and key
4. Worker → **Settings → Variables and Secrets** → add, as type **Secret**:

| Name | Value | Needed for |
|---|---|---|
| `RESEND_KEY` | your Resend API key | "join my trip" emails |
| `PRIM_TOKEN` | PRIM token (prim.iledefrance-mobilites.fr) | Paris Métro/RER times. Optional; walking times work without it |
| `GOOGLE_KEY` | Google Maps Platform key with **Places API (New)** enabled | Last-resort venue lookup and photos. Optional |

5. Visit **https://trips.sebwalker.co.uk/api/health**. You should see `{"ok":true,...}` showing which extras are switched on.

## 5. On your phone (2 min)

1. Open **trips.sebwalker.co.uk** in Safari → sign in with the code.
2. **Share → Add to Home Screen**, then open it from the home screen.
   - The first open downloads ~25 MB for offline use (the receipt and screenshot reader). Do this on Wi-Fi.
3. **New trip** → Paris → dates. Tap the avatars on Today → add where you're staying → **Add people** with name + email.

---

### How things work

- **Offline:** everything you add saves on the phone first. A small "Offline · 3 waiting to sync" badge shows anything the others can't see yet, and it syncs by itself when signal returns.
- **Screenshots, reels, links:** tap **+**.
  - Screenshots are read on the phone.
  - For a reel that saves the place for the end, use a screen recording.
  - Instagram links give the caption only; screenshots also catch the location tag.
- **Venue lookup** goes OpenStreetMap first and Google only if that fails. Anything unsure is shown as a question, never saved blindly.
- **Photos** come from your own screenshot first, then the venue's website, then Google as a last resort.
- **Privacy:** "Busy only" items show the crew a grey block. The real title is stored where only you can read it. "Just me" items are invisible to everyone else.
- **Updates:** push a change to GitHub and Cloudflare redeploys. The app updates itself the next time it's opened.

### Not in this version yet
- **Carnet in the iOS share sheet.** For now, tap **+** in Carnet and pick the screenshot (it's at the top of Recents).
- **Speech in reels.** Only text on screen is read, not names that are said out loud.
- **Métro times outside Paris.** Walking estimates work everywhere.
