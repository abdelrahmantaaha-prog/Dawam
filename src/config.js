/* ------------------------------------------------------------------ */
/*  Sync backend configuration (operator-level).                        */
/*                                                                      */
/*  These identify the app's Supabase project so users just sign in —   */
/*  they never see or enter backend details. The publishable key is     */
/*  public by design; row-level security is what isolates each          */
/*  account's rows. Override at build time with VITE_SUPABASE_URL /     */
/*  VITE_SUPABASE_KEY, or at runtime per-device via Settings → Sync →   */
/*  Advanced (kept for anyone who wants their own backend).             */
/* ------------------------------------------------------------------ */
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const SYNC_URL = env.VITE_SUPABASE_URL || 'https://eoqwtxxykkpfsfbfnxls.supabase.co';
export const SYNC_KEY = env.VITE_SUPABASE_KEY || 'sb_publishable_MtvZeTEksaketxmezMS8pw_7u9E10al';
