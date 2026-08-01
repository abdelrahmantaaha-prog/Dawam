/* Rhythm sync API — a single Vercel Node function running an Express app.

   Why one function rather than a file per route: Auth.js needs a catch-all
   mount for its own routes, the session helper has to be shared with every
   sync route, and cold starts are cheaper amortised over one bundle than four.

   Everything here is optional to the app. Rhythm works fully offline with no
   backend at all — that is the point of it — so /api/me reports what this
   deployment actually has configured and the client hides sync entirely rather
   than showing buttons that cannot work. */

import express from "express";
import { ExpressAuth, getSession } from "@auth/express";
import { authConfig, authConfigured, userIdFrom } from "./_auth.js";
import { isConfigured as dbConfigured, getDoc, insertDoc, updateDoc, deleteDoc } from "./_db.js";
import { pushDocument } from "./_sync-core.js";

/* the store seam _sync-core.js writes through — Neon in production, an
   in-memory fake in the tests */
const neonStore = { get: getDoc, insert: insertDoc, update: updateDoc };

const app = express();

// Vercel terminates TLS upstream; without this Express reports http:// and
// Auth.js builds callback URLs that Google refuses.
app.set("trust proxy", true);
app.disable("x-powered-by");

app.use(express.json({ limit: "8mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

/* ---------- rate limiting ----------
   Per warm instance and therefore approximate — Vercel may run several. It is
   not a security boundary, just a cheap brake on a runaway client looping on
   push. The real protections are the session requirement and the size cap. */
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = (req.ip || "anon") + ":" + req.path;
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now > rec.reset) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 5000) hits.clear(); // bound the map on a long-lived instance
      return next();
    }
    if (rec.n >= max) {
      res.setHeader("Retry-After", Math.ceil((rec.reset - now) / 1000));
      return res.status(429).json({ error: "rate-limited" });
    }
    rec.n++;
    next();
  };
}

/* ---------- auth ---------- */
if (authConfigured()) {
  app.use("/api/auth", ExpressAuth(authConfig));
} else {
  app.use("/api/auth", (_req, res) =>
    res.status(503).json({ error: "auth-unconfigured", detail: "Set AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET." })
  );
}

async function session(req) {
  if (!authConfigured()) return null;
  try {
    return await getSession(req, authConfig);
  } catch {
    return null;
  }
}

async function requireUser(req, res) {
  const s = await session(req);
  const id = userIdFrom(s);
  if (!id) {
    res.status(401).json({ error: "signed-out" });
    return null;
  }
  return { id, email: s.user && s.user.email };
}

/* ---------- capability probe ----------
   The client calls this once on boot to decide whether to offer sync at all. */
app.get("/api/me", async (req, res) => {
  const s = await session(req);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    sync: authConfigured() && dbConfigured(),
    auth: authConfigured(),
    db: dbConfigured(),
    user: s && s.user ? { id: userIdFrom(s), name: s.user.name, email: s.user.email, image: s.user.image } : null,
  });
});

/* ---------- pull ---------- */
app.get("/api/sync", rateLimit(120, 60_000), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const row = await getDoc(user.id);
    res.setHeader("Cache-Control", "no-store");
    if (!row) return res.json({ rev: 0, doc: null });
    res.json({ rev: row.rev, doc: row.doc, updatedAt: row.updatedAt });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.code || "pull-failed" });
  }
});

/* ---------- push ----------
   The client sends its whole document. The server merges it with what it has
   and returns the result, which the client adopts. mergeState is symmetric and
   idempotent, so this needs no change log, no vector clocks and no
   reconciliation code on the client. Rhythm's document is a map of planner
   keys, so "merge" resolves per key — two devices editing different weeks both
   keep their work. */
app.post("/api/sync", rateLimit(60, 60_000), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const out = await pushDocument(neonStore, user.id, user.email, req.body && req.body.doc);
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.code || "push-failed" });
  }
});

/* ---------- disconnect ----------
   Removes the cloud copy only. The device keeps its local data, which is why
   the client wording is "stop syncing", not "delete my data". */
app.delete("/api/sync", rateLimit(10, 60_000), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    await deleteDoc(user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.code || "delete-failed" });
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "not-found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("api error", err);
  res.status(err.status || 500).json({ error: "server-error" });
});

export default app;
