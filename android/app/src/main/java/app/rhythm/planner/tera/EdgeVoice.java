package app.rhythm.planner.tera;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/* Microsoft's neural read-aloud voices — the ones Edge uses — spoken to
   directly, the way the edge-tts Python package does it.

   Why these: the owner picked them. Salma (ar-EG) is a real Egyptian voice,
   which matters more for a sarcastic secretary than any amount of expressive
   control; the delivery is the voice's own, so the sarcasm has to live in the
   words Tera chooses.

   The protocol, as edge-tts 7.3.1 speaks it: open a websocket with a
   time-based token (EdgeToken) and the headers the Edge extension sends, send
   a speech.config message and then the SSML, and collect binary frames whose
   header says Path:audio until a text frame says Path:turn.end. The audio is
   24 kHz mono MP3, and MP3 frames concatenate, so a long reply split into
   pieces is still one playable file.

   It is an unofficial endpoint. When it refuses (a 403 after a token change,
   no network), the caller falls back to the phone's own voice rather than
   staying silent — see TeraSpeaker. */
public final class EdgeVoice {
    private EdgeVoice() {}

    private static final String WSS = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken="
        + EdgeToken.TRUSTED_CLIENT_TOKEN;
    private static final String UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
        + EdgeToken.CHROMIUM_MAJOR + ".0.0.0 Safari/537.36 Edg/" + EdgeToken.CHROMIUM_MAJOR + ".0.0.0";

    /* The server's clock wins: a phone a few minutes off would otherwise build
       a token for the wrong five-minute window and get a 403 every time. Learnt
       from the Date header of a refusal, exactly as edge-tts does. */
    private static volatile double skewSeconds = 0;

    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build();

    static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace("\"", "&quot;").replace("'", "&apos;");
    }

    private static String jsDate() {
        SimpleDateFormat f = new SimpleDateFormat("EEE MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    private static String id() { return UUID.randomUUID().toString().replace("-", ""); }

    private static String muid() {
        StringBuilder sb = new StringBuilder();
        java.security.SecureRandom r = new java.security.SecureRandom();
        for (int i = 0; i < 16; i++) sb.append(String.format(Locale.US, "%02X", r.nextInt(256)));
        return sb.toString();
    }

    /** Synthesise `text` with `voice` (e.g. "ar-EG-SalmaNeural"). rate/pitch as
        SSML prosody strings: "+0%", "+6%", "+0Hz". Blocking; call off the main thread. */
    public static byte[] synth(String text, String voice, String rate, String pitch) throws IOException {
        ByteArrayOutputStream all = new ByteArrayOutputStream();
        for (String piece : split(text, 2500)) {
            byte[] b;
            try {
                b = once(piece, voice, rate, pitch);
            } catch (SkewException e) {
                b = once(piece, voice, rate, pitch); // one retry with the corrected clock
            }
            all.write(b);
        }
        if (all.size() == 0) throw new IOException("no audio");
        return all.toByteArray();
    }

    /* Split on sentence ends, never inside a word — the service caps an SSML
       request, and a cut mid-word is audible. */
    static java.util.List<String> split(String text, int max) {
        java.util.List<String> out = new java.util.ArrayList<>();
        String t = text.trim();
        while (t.length() > max) {
            int cut = -1;
            for (String mark : new String[] { ". ", "؟ ", "? ", "! ", "، ", ", ", "\n", " " }) {
                int i = t.lastIndexOf(mark, max);
                if (i > max / 3) { cut = i + mark.length(); break; }
            }
            if (cut < 0) cut = max;
            out.add(t.substring(0, cut).trim());
            t = t.substring(cut).trim();
        }
        if (!t.isEmpty()) out.add(t);
        return out;
    }

    static final class SkewException extends IOException { SkewException(String m) { super(m); } }

    private static byte[] once(String text, String voice, String rate, String pitch) throws IOException {
        String url = WSS + "&ConnectionId=" + id()
            + "&Sec-MS-GEC=" + EdgeToken.now(skewSeconds)
            + "&Sec-MS-GEC-Version=" + EdgeToken.GEC_VERSION;
        Request req = new Request.Builder().url(url)
            .header("Pragma", "no-cache")
            .header("Cache-Control", "no-cache")
            .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
            .header("User-Agent", UA)
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Cookie", "muid=" + muid() + ";")
            .build();

        final ByteArrayOutputStream audio = new ByteArrayOutputStream();
        final CountDownLatch done = new CountDownLatch(1);
        final IOException[] failure = { null };

        String config = "X-Timestamp:" + jsDate() + "\r\n"
            + "Content-Type:application/json; charset=utf-8\r\n"
            + "Path:speech.config\r\n\r\n"
            + "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{"
            + "\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},"
            + "\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}\r\n";
        String ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>"
            + "<voice name='" + voice + "'><prosody pitch='" + pitch + "' rate='" + rate + "' volume='+0%'>"
            + escape(text) + "</prosody></voice></speak>";
        String ssmlMsg = "X-RequestId:" + id() + "\r\n"
            + "Content-Type:application/ssml+xml\r\n"
            + "X-Timestamp:" + jsDate() + "Z\r\n" // the trailing Z is Edge's own bug, kept
            + "Path:ssml\r\n\r\n" + ssml;

        WebSocket ws = HTTP.newWebSocket(req, new WebSocketListener() {
            @Override public void onOpen(WebSocket w, Response r) {
                w.send(config);
                w.send(ssmlMsg);
            }
            @Override public void onMessage(WebSocket w, String text) {
                if (text.contains("Path:turn.end")) { w.close(1000, null); done.countDown(); }
            }
            @Override public void onMessage(WebSocket w, ByteString bytes) {
                byte[] b = bytes.toByteArray();
                if (b.length < 2) return;
                int hl = ((b[0] & 0xFF) << 8) | (b[1] & 0xFF);
                if (hl + 2 > b.length) return;
                String head = new String(b, 2, hl, StandardCharsets.US_ASCII);
                if (head.contains("Path:audio")) audio.write(b, 2 + hl, b.length - 2 - hl);
            }
            @Override public void onFailure(WebSocket w, Throwable t, Response r) {
                if (r != null && r.code() == 403) {
                    String date = r.header("Date");
                    if (date != null) {
                        try {
                            SimpleDateFormat f = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US);
                            double server = f.parse(date).getTime() / 1000.0;
                            skewSeconds += server - (System.currentTimeMillis() / 1000.0 + skewSeconds);
                            failure[0] = new SkewException("403, clock corrected");
                        } catch (Exception ignored) { /* fall through to a plain failure */ }
                    }
                }
                if (failure[0] == null) failure[0] = new IOException(r != null ? "HTTP " + r.code() : String.valueOf(t));
                done.countDown();
            }
            @Override public void onClosed(WebSocket w, int code, String reason) { done.countDown(); }
        });

        try {
            if (!done.await(20, TimeUnit.SECONDS)) { ws.cancel(); throw new IOException("timeout"); }
        } catch (InterruptedException e) {
            ws.cancel();
            throw new IOException("interrupted");
        }
        if (failure[0] != null) throw failure[0];
        return audio.toByteArray();
    }
}
