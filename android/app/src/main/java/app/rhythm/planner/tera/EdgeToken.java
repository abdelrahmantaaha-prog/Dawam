package app.rhythm.planner.tera;

import java.nio.charset.StandardCharsets;

/* The Sec-MS-GEC token Microsoft's read-aloud voices ask for.

   A straight port of edge-tts 7.3.1's drm.py (generate_sec_ms_gec_v2), which
   is the reference this was checked against byte for byte on 2026-11-13: the
   timestamps in main() and the current time gave the same tokens from both
   (compile this one file with javac and run it next to
   `python -c "from edge_tts.drm import generate_sec_ms_gec_v2 as g; print(g(T))"`).
   The service changes this from time to time; when the
   voices stop answering with a 403, the first thing to compare is a newer
   edge-tts against this file.

   The scheme: Windows file time rounded down to five minutes, followed by the
   public trusted-client token, hashed two ways — a SHA-256 whose first block
   starts from a fixed midstate (so the hidden prefix never appears here), and
   a 64-bit checksum keyed by that digest. Plain Java, no Android types, so the
   check can run on a PC. Everything is 32-bit arithmetic: Java's int wraps
   exactly the way the Python's "& 0xFFFFFFFF" does. */
public final class EdgeToken {
    private EdgeToken() {}

    public static final String TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    public static final String CHROMIUM_FULL_VERSION = "143.0.3650.75";
    public static final String CHROMIUM_MAJOR = "143";
    public static final String GEC_VERSION = "2-" + CHROMIUM_FULL_VERSION;
    private static final long WIN_EPOCH = 11644473600L;

    private static final int[] INITIAL = {
        0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
    };
    private static final int[] STATE = {
        0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2,
    };
    private static final int[] SCHEDULE = {
        0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0,
        0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564,
    };
    private static final int[] K = {
        0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
        0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
        0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
        0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
        0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
        0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
        0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
        0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
    };
    private static final int ADJ = 0xC9DC06A7;
    private static final int[] BLOCK_K = K.clone();
    static { BLOCK_K[14] = ADJ; }
    private static final int SIG0_ADJ = 0x059C0B80;
    private static final int SIG1_ADJ = 0x000B92C0;

    private static final int[][] CS64 = {
        {0xE82E91B1, 0xB32700D0}, {0x44DE24C6, 0x88DFF51D}, {0x3BEB65BC, 0x29514038},
        {0xC89C5933, 0xB328CBDF}, {0x8D1EC211, 0xD405B4D5}, {0x314EF5D5, 0x26E55F3C},
        {0xE92491B1, 0x607801C6}, {0xF0A5B9D5, 0x82B2C1FB}, {0x06064CF3, 0xFA51A3DA},
        {0xDA79FA60, 0x207CC464}, {0xBED20560, 0x3C3C74F3}, {0x89F9C9F8, 0xD2D14B61},
        {0x35FA38C6, 0xBB04A2C1}, {0xCB49E3C6, 0xC5626167},
    };
    private static final int CS64_FACTOR = 0x82893933;
    private static final int CS64_ADJ0 = 0xF2F90B1A;
    private static final int CS64_ADJ1 = 0x0B1A0000;

    private static int rol16(int v) { return Integer.rotateLeft(v, 16); }
    private static int sigma0(int v) { return Integer.rotateRight(v, 7) ^ Integer.rotateRight(v, 18) ^ (v >>> 3); }
    private static int sigma1(int v) { return Integer.rotateRight(v, 17) ^ Integer.rotateRight(v, 19) ^ (v >>> 10); }

    private static int[] rounds(int[] st, int[] w, int first) {
        int[] k = first == 14 ? BLOCK_K : K;
        int a = st[0], b = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
        for (int i = first; i < 64; i++) {
            int s1 = Integer.rotateRight(e, 6) ^ Integer.rotateRight(e, 11) ^ Integer.rotateRight(e, 25);
            int ch = g ^ (e & (f ^ g));
            int t1 = h + s1 + ch + k[i] + w[i];
            int s0 = Integer.rotateRight(a, 2) ^ Integer.rotateRight(a, 13) ^ Integer.rotateRight(a, 22);
            int maj = (a & b) | (c & (a | b));
            int t2 = s0 + maj;
            h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
        }
        return new int[] { a, b, c, d, e, f, g, h };
    }

    private static void expand(int[] w, int from) {
        for (int i = from; i < 64; i++) w[i] = sigma1(w[i - 2]) + w[i - 7] + sigma0(w[i - 15]) + w[i - 16];
    }

    private static int be(byte[] d, int off, int len) {
        int v = 0;
        for (int i = 0; i < len; i++) v = (v << 8) | (d[off + i] & 0xFF);
        return v;
    }

    private static int[] init(byte[] data) {
        int[] w = new int[64];
        w[14] = be(data, 0, 3);
        w[15] = be(data, 3, 4);
        for (int i = 16; i < 30; i++) {
            int v = SCHEDULE[i - 16];
            if (i - 2 >= 14) v += i == 16 ? (sigma1(w[i - 2]) ^ SIG1_ADJ) : sigma1(w[i - 2]);
            if (i - 7 >= 14) v += w[i - 7];
            if (i - 15 >= 14) v += i == 29 ? (sigma0(w[i - 15]) ^ SIG0_ADJ) : sigma0(w[i - 15]);
            w[i] = v;
        }
        w[30] = sigma1(w[28]) + w[23] + sigma0(w[15]) + w[14] + ADJ - K[14];
        expand(w, 31);
        int[] r = rounds(STATE, w, 14);
        int[] out = new int[8];
        for (int i = 0; i < 8; i++) out[i] = INITIAL[i] + r[i];
        return out;
    }

    static byte[] sha(byte[] data) {
        int length = 57 + data.length;
        int zeros = Math.floorMod(55 - length, 64);
        int tail = data.length - 7;
        byte[] padded = new byte[tail + 1 + zeros + 8];
        System.arraycopy(data, 7, padded, 0, tail);
        padded[tail] = (byte) 0x80;
        long bits = (long) length * 8L;
        for (int i = 0; i < 8; i++) padded[padded.length - 1 - i] = (byte) (bits >>> (8 * i));
        int[] state = init(data);
        for (int off = 0; off < padded.length; off += 64) {
            int[] w = new int[64];
            for (int i = 0; i < 16; i++) w[i] = be(padded, off + i * 4, 4);
            expand(w, 16);
            int[] r = rounds(state, w, 0);
            for (int i = 0; i < 8; i++) state[i] += r[i];
        }
        byte[] out = new byte[32];
        for (int i = 0; i < 8; i++) for (int j = 0; j < 4; j++) out[i * 4 + j] = (byte) (state[i] >>> (24 - 8 * j));
        return out;
    }

    private static int le(byte[] d, int off) {
        return (d[off] & 0xFF) | ((d[off + 1] & 0xFF) << 8) | ((d[off + 2] & 0xFF) << 16) | ((d[off + 3] & 0xFF) << 24);
    }

    static int[] cs64(byte[] data, byte[] digest) {
        int keyA = le(digest, 0) | 1;
        int keyB = le(digest, 4) | 1;
        int[] factors = { keyA * CS64_FACTOR, keyB * CS64_FACTOR };
        // b"\x00" + data, zero-padded to whole words, then to an even count.
        int raw = data.length + 1;
        int nWords = (raw + 3) / 4;
        if (nWords % 2 == 1) nWords++;
        byte[] buf = new byte[nWords * 4];
        System.arraycopy(data, 0, buf, 1, data.length);
        int n = CS64.length + nWords;
        int[] terms = new int[n];
        int[] offsets = new int[n];
        for (int i = 0; i < CS64.length; i++) { terms[i] = CS64[i][0] * factors[i % 2]; offsets[i] = CS64[i][1]; }
        for (int i = 0; i < nWords; i++) {
            int word = le(buf, i * 4);
            int term = word * (i % 2 == 0 ? keyA : keyB);
            int offset = rol16(word) * (i % 2 == 0 ? 0xEF0569FB : 0xC31713DB);
            if (i == 0) { term += CS64_ADJ0 * factors[0]; offset += CS64_ADJ1; }
            terms[CS64.length + i] = term;
            offsets[CS64.length + i] = offset;
        }
        int swapAcc = 0, swapLast = 0, state = 0, acc = 0;
        for (int i = 0; i < n; i += 2) {
            int x = terms[i], y = terms[i + 1];
            int t = rol16(offsets[i] + x);
            int q = t * 0x76F50F34;
            swapAcc += rol16(q) * 0xC3EFEA97 + q;
            t = rol16(offsets[i + 1] + y);
            q = t * 0x1881CE3C;
            swapLast = rol16(q) * 0x35BD1EC9 + q;
            swapAcc += swapLast;

            state = state * keyA + x;
            state = rol16(state) * 0xCF98B111;
            state = rol16(state) * 0x87085B9F;
            state = rol16(state) * 0x12CEB96D;
            state = rol16(state) * 0x257E1D83;
            acc += state;
            t = state * keyB + y;
            t = rol16(t) * 0xA27416F5;
            t = rol16(t) * 0xD38396FF;
            state = rol16(rol16(t) * 0x7C932B89) * 0xBFA49F69;
            acc += state;
        }
        return new int[] { swapLast ^ state, swapAcc ^ acc };
    }

    private static final char[] HEX = "0123456789ABCDEF".toCharArray();

    private static void hex(StringBuilder sb, byte b) { sb.append(HEX[(b >>> 4) & 15]).append(HEX[b & 15]); }

    /** The token for a moment in time, in seconds since 1970. */
    public static String forUnixSeconds(double unixSeconds) {
        long secs = (long) Math.floor(unixSeconds) + WIN_EPOCH;
        secs -= secs % 300;
        long ticks = secs * 10_000_000L;
        byte[] data = (ticks + TRUSTED_CLIENT_TOKEN).getBytes(StandardCharsets.US_ASCII);
        byte[] digest = sha(data);
        int[] cs = cs64(data, digest);
        StringBuilder sb = new StringBuilder(81);
        for (int v : cs) for (int j = 0; j < 4; j++) hex(sb, (byte) (v >>> (8 * j)));
        sb.append('-');
        for (byte b : digest) hex(sb, b);
        return sb.toString();
    }

    public static String now(double skewSeconds) {
        return forUnixSeconds(System.currentTimeMillis() / 1000.0 + skewSeconds);
    }

    /* PC check: prints the tokens for the same timestamps the Python printed. */
    public static void main(String[] args) {
        double[] ts = args.length > 0 ? new double[args.length] : new double[] { 1763000000, 1700000000.5, 1800000123 };
        for (int i = 0; i < args.length; i++) ts[i] = Double.parseDouble(args[i]);
        for (double t : ts) System.out.println((long) t + " " + forUnixSeconds(t));
    }
}
