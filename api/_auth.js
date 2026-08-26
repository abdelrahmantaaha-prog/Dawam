/* Auth.js configuration.

   JWT sessions, no database adapter. That is a deliberate choice: with a
   single OAuth provider there is nothing to link, so an adapter would add a
   users/accounts/sessions schema and a round trip to Postgres on every request
   in exchange for nothing the app uses. The session cookie carries the
   identity; Postgres only ever holds the synced document.

   Identity key is "google:<sub>". Google's `sub` is stable for the life of the
   account, unlike the email address, so changing your Gmail address does not
   orphan your data. */

import Google from "@auth/express/providers/google";
import crypto from "node:crypto";

export const AUTH_BASE_PATH = "/api/auth";

export function authConfigured() {
  return !!(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

export const authConfig = {
  basePath: AUTH_BASE_PATH,
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 90 }, // 90 days: this is a phone app people open weekly
  providers: authConfigured()
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          // no refresh token needed — we never call Google APIs on the user's behalf
          authorization: { params: { prompt: "select_account" } },
        }),
      ]
    : [],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && account.provider) {
        token.rhythmId = `${account.provider}:${account.providerAccountId || token.sub}`;
      }
      if (profile && profile.email) token.email = profile.email;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.rhythmId || (token.sub ? `google:${token.sub}` : null);
      }
      return session;
    },
  },
  cookies: {
    sessionToken: {
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    },
  },
};

/* The identity the sync endpoints key on. Returns null when unauthenticated. */
export function userIdFrom(session) {
  if (!session || !session.user) return null;
  return session.user.id || null;
}

/* ---------- device tokens ----------
   The Android app cannot complete cookie sign-in: Google refuses OAuth inside
   a WebView, and the WebView's own origin could never carry the deployment's
   cookie anyway. So a phone links with a token instead: minted by a
   cookie-signed-in session, shown once, pasted on the phone, and sent as a
   Bearer header from then on. It is an HMAC over the user id under
   AUTH_SECRET — no storage, no expiry (a phone that has to re-link weekly
   would just stop being used), revoked for everyone by rotating AUTH_SECRET. */
const b64u = (buf) => Buffer.from(buf).toString("base64url");

export function mintDeviceToken(userId) {
  const payload = b64u(JSON.stringify({ u: userId, iat: Date.now() }));
  const sig = b64u(crypto.createHmac("sha256", process.env.AUTH_SECRET).update(payload).digest());
  return `dt1.${payload}.${sig}`;
}

export function verifyDeviceToken(token) {
  try {
    const [v, payload, sig] = String(token || "").trim().split(".");
    if (v !== "dt1" || !payload || !sig) return null;
    const want = b64u(crypto.createHmac("sha256", process.env.AUTH_SECRET).update(payload).digest());
    const a = Buffer.from(sig), b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const j = JSON.parse(Buffer.from(payload, "base64url").toString());
    return j && typeof j.u === "string" && j.u ? j.u : null;
  } catch {
    return null;
  }
}

export const bearerFrom = (req) => {
  const m = /^Bearer\s+(.+)$/.exec((req.headers && req.headers.authorization) || "");
  return m ? verifyDeviceToken(m[1]) : null;
};
