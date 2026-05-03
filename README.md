# 🎉 Mickey & Minnie 3D Invitation Website

A 3D animated, mobile-friendly birthday invitation website for two kids with a Mickey & Minnie Mouse theme. Includes a hidden admin dashboard to track RSVPs and download the guest list as Excel.

## ✨ Features

- **3D animated background** with Three.js (floating Mickey-ear silhouettes, rising balloons, twinkling stars, mouse parallax)
- **Cover-flip reveal animation** — guests click "Open Invitation" to reveal the card
- **Two-photo layout** for both kids in tilted polaroid-style frames
- **Live countdown** to the event
- **RSVP form** (yes/no, guest count, kids count, message)
- **Confetti burst** when an RSVP is submitted
- **Optional Web Audio jingle** (no audio file needed — generated via Web Audio API, copyright-safe)
- **Hidden admin dashboard** at a secret URL of your choosing, protected by HTTP basic auth
- **Excel export** of all RSVPs with stats summary
- **Dockerized** for easy deployment to Render's free tier

---

## 📁 Project structure

```
invitation/
├── Dockerfile
├── render.yaml             # Render one-click blueprint
├── package.json
├── server.js               # Express server (RSVP API + admin)
├── .env.example
├── .gitignore
├── .dockerignore
├── data/                   # SQLite DB lives here
└── public/
    ├── index.html          # Main 3D invitation page
    ├── admin.html          # Hidden admin dashboard
    ├── css/style.css
    ├── js/
    │   ├── scene.js        # Three.js 3D scene
    │   ├── main.js         # Page logic (cover, countdown, RSVP, music)
    │   └── admin.js        # Admin dashboard logic
    └── images/
        ├── kid-1.png       # ← place your son's themed photo here
        ├── kid-2.png       # ← place your daughter's themed photo here
        ├── placeholder-boy.svg
        └── placeholder-girl.svg
```

---

## 🚀 Quick start (local)

You need **Node.js 20+** installed.

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and edit
cp .env.example .env
# Then open .env and set ADMIN_USER, ADMIN_PASS, ADMIN_PATH

# 3. Run
npm start
```

Open http://localhost:3000 — the invitation page.
Open http://localhost:3000/<ADMIN_PATH> — the admin dashboard (will prompt for username/password).

### Or run via Docker locally

```bash
docker build -t invitation .
docker run -p 3000:3000 \
  -e ADMIN_USER=parent \
  -e ADMIN_PASS=mysecret123 \
  -e ADMIN_PATH=admin-xyz-2026 \
  -v $(pwd)/data:/app/data \
  invitation
```

---

## ✏️ Customizing the invitation

Open `public/index.html` and look for comments marked **`✏️ EDIT`**. You'll customize:

| What | Where in `index.html` |
|---|---|
| Kids' names (cover) | `<span class="name-1">` and `<span class="name-2">` |
| Kids' names (card) | `<span class="kid-name boy">` and `<span class="kid-name girl">` |
| Their ages | `<strong class="ages">5 &amp; 7</strong>` |
| Date and time | inside `<div class="detail">` for "When" |
| Venue | inside `<div class="detail">` for "Where" |
| Caption labels (e.g. "The Birthday Boy") | `<figcaption>` blocks |

Then in `public/js/main.js`, set the **event date for the countdown**:

```js
const EVENT_DATE = new Date('2026-06-15T15:00:00');
```

---

## 🖼️ How to generate Mickey & Minnie themed photos of your kids

You have normal photos. You want them to look like they're styled as Mickey/Minnie. Here are the best approaches, ordered from easiest & free to higher quality.

### Option 1 — Free AI image generators (easiest)

These let you upload a photo and a prompt to "stylize" it.

**A. Microsoft Designer / Bing Image Creator** (free with a Microsoft account)
- https://designer.microsoft.com → "Image Creator"
- Use the "edit image" → "restyle" feature.
- Sample prompt: *"A cheerful young boy wearing a red Mickey Mouse t-shirt, black mouse-ear headband, classic Disney 1950s cartoon style, polka dot background, bright lighting, cute and friendly"*

**B. Google Gemini (free tier)** — https://gemini.google.com
- Upload your child's photo.
- Prompt: *"Generate a stylized portrait of this child as if they were dressed up for a Mickey Mouse themed birthday party. They should be wearing red, black, and white Mickey-themed clothing with Mickey ears. Vibrant cartoon-meets-photo aesthetic. Keep their face recognizable."*

**C. Leonardo.AI** (free credits daily) — https://leonardo.ai
- Use the "Image Guidance" feature with your child's photo as a reference.
- Choose the "Disney-style" or "3D Cartoon" model.
- Prompt example for the boy: *"Cute boy with mickey mouse ears headband, red shorts and yellow shoes, big smile, Disney-style 3D render, polka dot background, soft studio lighting, festive"*
- For the girl: *"Cute girl with minnie mouse pink and white polka dot bow, red polka dot dress, big smile, Disney-style 3D render, polka dot background, soft studio lighting, festive"*

**D. ChatGPT Plus / Google ImageFX / Adobe Firefly** — all good options if you have access.

### Option 2 — Photo editing approach (most control, no AI)

If you want a **photo of your real child** but with Mickey/Minnie *added* (ears, accessories, themed background):

1. **Remove the background** for free at https://www.remove.bg or https://www.photoroom.com
2. **Open in Canva** (free at canva.com) — Canva has thousands of Mickey & Minnie graphics, polka dot backgrounds, ear headbands, balloons, etc. you can drag onto the photo.
3. **Add Mickey ears**: search Canva for "mickey ears png" and place over your child's head.
4. **Add a themed background**: search "polka dot red background" or "disney party background".
5. **Export as PNG** and save as `kid-1.png` and `kid-2.png`.

This is by far the best method if you want the **actual face of your child** preserved 100%.

### Option 3 — Hybrid (recommended)

1. Use a free AI tool to generate a **themed background scene** with no people in it (e.g. "Mickey Mouse clubhouse interior, polka dot walls, balloons, cinematic 3D Disney style").
2. Cut out your child's photo with remove.bg.
3. Composite them in Canva, and add a Mickey/Minnie ears PNG on top of their head.

You get a recognizable photo of your real child *in* a themed scene.

### 💡 Prompts to try (for any AI tool)

For your **son** (Mickey theme):
> *"Studio portrait of a [age]-year-old boy, smiling, wearing red mickey-mouse-style overalls with two big white buttons, white gloves, yellow shoes, black mickey ears headband, against a pastel polka-dot background, Pixar-style 3D render, soft volumetric lighting, festive birthday atmosphere, ultra detailed"*

For your **daughter** (Minnie theme):
> *"Studio portrait of a [age]-year-old girl, smiling, wearing a red polka dot dress, big pink and white polka dot bow on her head, white gloves, yellow shoes, black minnie ears headband, against a pastel polka-dot background, Pixar-style 3D render, soft volumetric lighting, festive birthday atmosphere, ultra detailed"*

### Where to put the final images

Save them as:
- `public/images/kid-1.png` (your son)
- `public/images/kid-2.png` (your daughter)

**Recommended size**: 600×800 px (3:4 portrait), under 500 KB each. PNG or high-quality JPG both work.

---

## ☁️ Deploying to Render (free)

### Step 1 — Push to GitHub

```bash
cd invitation
git init
git add .
git commit -m "Initial invitation site"
git branch -M main
# Create a new repo on github.com first, then:
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

### Step 2 — Create a Render account

Go to https://render.com and sign up (free).

### Step 3 — Deploy

**Option A — One-click via the included `render.yaml`:**
1. In Render dashboard → **New +** → **Blueprint**
2. Connect your GitHub repo.
3. Render reads `render.yaml` and asks for `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_PATH`.
4. Click **Apply**.

**Option B — Manual:**
1. **New +** → **Web Service** → connect your repo.
2. Set **Runtime**: `Docker`.
3. Set **Plan**: `Free`.
4. Add environment variables under "Environment":
   - `ADMIN_USER` — e.g. `parent`
   - `ADMIN_PASS` — strong password
   - `ADMIN_PATH` — random string, e.g. `xq8m2-rsvp-mickey-2026`
5. Click **Create Web Service**.

After 3–5 minutes you'll get a URL like `https://your-app-name.onrender.com`.

- Public invitation: `https://your-app-name.onrender.com/`
- Hidden admin: `https://your-app-name.onrender.com/<ADMIN_PATH>`

### ⚠️ About data persistence on Render's free plan

Render's free plan does **not** include persistent disks, so the SQLite database will be **wiped on every redeploy or after ~15 min of inactivity** (free instances spin down).

**Recommended workflow for free tier:**
1. Deploy and share the link to guests.
2. Periodically log in to `/<ADMIN_PATH>` and **download the Excel file**.
3. Don't redeploy unless necessary; the DB survives normal operation, only resets on cold-start of a *new* container.

**For full persistence (recommended for important events):**
- Upgrade to Render's **Starter plan ($7/month)** and uncomment the `disk:` block at the bottom of `render.yaml`. The DB will then persist across redeploys.
- Or switch to a free hosted Postgres database (Neon, Supabase, Render's free Postgres) — requires changing `server.js` to use `pg` instead of `better-sqlite3`. Ask if you'd like me to add that.

---

## 🔐 Security notes

- The admin URL (`ADMIN_PATH`) acts as a "secret link" — do not put it in the homepage or share it publicly.
- The admin URL is **also** protected by HTTP basic auth (`ADMIN_USER` + `ADMIN_PASS`). Even if someone guesses the URL, they still need the password.
- Use a long random string for `ADMIN_PATH` (e.g. generated at https://1password.com/password-generator).
- Use a strong password for `ADMIN_PASS`.
- The site runs over HTTPS by default on Render, so basic auth credentials are encrypted in transit.

---

## 🛠 Useful commands

```bash
npm install       # install dependencies
npm start         # run the server on PORT (default 3000)
docker build -t invitation .
docker run -p 3000:3000 invitation
```

---

## ❓ Troubleshooting

- **`better-sqlite3` build errors locally**: install Python 3 and a C++ compiler (Xcode CLI tools on macOS, build-essential on Linux). Or just use Docker, which handles it for you.
- **Photos not showing**: make sure they're at `public/images/kid-1.png` and `public/images/kid-2.png` (case-sensitive).
- **Admin URL returns 404**: it must match the `ADMIN_PATH` env var exactly (no leading slash in the variable, e.g. `admin-xyz-2026`).
- **RSVP form doesn't submit**: open browser DevTools → Network tab → look for the failed `/api/rsvp` request and check the error.

---
Made with ❤️ for two very special kids.
