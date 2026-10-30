package vn.sochungkhoan.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity {
    static final int SAVE = 1, OPEN = 2;
    WebView w;
    String pending = "";

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        w = new WebView(this);
        setContentView(w);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        w.setWebViewClient(new WebViewClient());
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView v, String u, String m, final JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(m)
                    .setPositiveButton("OK", (d, i) -> r.confirm())
                    .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }
            @Override
            public boolean onJsConfirm(WebView v, String u, String m, final JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(m)
                    .setPositiveButton("OK", (d, i) -> r.confirm())
                    .setNegativeButton("Hủy", (d, i) -> r.cancel())
                    .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }
        });
        w.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void save(String json) {
                pending = json;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TITLE, "so-chung-khoan-" + new SimpleDateFormat("yyyyMMdd", Locale.US).format(new Date()) + ".txt");
                startActivityForResult(i, SAVE);
            }
            @JavascriptInterface
            public void open() {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                startActivityForResult(i, OPEN);
            }
            @JavascriptInterface
            public void prices(final String csv) {
                new Thread(() -> {
                    JSONObject pr = new JSONObject(), prev = new JSONObject(), sr = new JSONObject();
                    JSONArray e = new JSONArray();
                    String[] names = {"VPS", "VNDirect", "DNSE", "TCBS"};
                    for (String t : csv.split(",")) {
                        t = t.trim().toUpperCase(Locale.US);
                        if (!t.matches("[A-Z0-9]{1,10}")) continue;
                        double v = 0;
                        String src = "";
                        for (String n : names) {
                            try { v = fetchQuote(n, t); } catch (Exception ex) { v = 0; }
                            if (v > 0) { src = n; break; }
                        }
                        try {
                            if (v > 0) {
                                pr.put(t, v); sr.put(t, src);
                                try { double pv = fetchPreviousClose(t, now); if (pv > 0) prev.put(t, pv); } catch (Exception ignored) { }
                            } else { e.put(t); }
                        } catch (Exception ex) { }
                    }
                    String out = "{}";
                    try {
                        JSONObject r = new JSONObject();
                        r.put("p", pr);
                        r.put("prev", prev);
                        r.put("s", sr);
                        r.put("e", e);
                        out = r.toString();
                    } catch (Exception ex) { }
                    final String res = out;
                    runOnUiThread(() -> w.evaluateJavascript("pxDone(" + JSONObject.quote(res) + ")", null));
                }).start();
            }

            @JavascriptInterface
            public void sheetsSync(final String endpoint, final String payload) {
                new Thread(() -> {
                    String response;
                    try {
                        if (endpoint == null || !endpoint.startsWith("https://script.google.com/"))
                            throw new Exception("URL phải là địa chỉ HTTPS Google Apps Script dạng /macros/s/.../exec");
                        byte[] body = payload.getBytes(StandardCharsets.UTF_8);
                        HttpURLConnection c = (HttpURLConnection) new URL(endpoint).openConnection();
                        c.setRequestMethod("POST");
                        c.setDoOutput(true);
                        c.setInstanceFollowRedirects(false);
                        c.setConnectTimeout(15000);
                        c.setReadTimeout(20000);
                        c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                        c.setRequestProperty("Accept", "application/json");
                        OutputStream os = c.getOutputStream(); os.write(body); os.close();
                        int status = c.getResponseCode();
                        String location = c.getHeaderField("Location");
                        if (status >= 300 && status < 400 && location != null) {
                            c.disconnect();
                            HttpURLConnection follow = (HttpURLConnection) new URL(location).openConnection();
                            follow.setRequestMethod("GET");
                            follow.setConnectTimeout(15000);
                            follow.setReadTimeout(20000);
                            status = follow.getResponseCode();
                            InputStream in = status >= 400 ? follow.getErrorStream() : follow.getInputStream();
                            response = readText(in);
                            follow.disconnect();
                        } else {
                            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                            response = readText(in);
                            c.disconnect();
                        }
                        if (status >= 400) throw new Exception("HTTP " + status + ": " + response);
                    } catch (Exception ex) {
                        JSONObject err = new JSONObject();
                        try { err.put("ok", false); err.put("message", ex.getMessage() == null ? "Lỗi kết nối" : ex.getMessage()); response = err.toString(); }
                        catch (Exception ignored) { response = "{\"ok\":false,\"message\":\"Lỗi kết nối\"}"; }
                    }
                    final String result = response;
                    runOnUiThread(() -> w.evaluateJavascript("syncDone(" + JSONObject.quote(result) + ")", null));
                }).start();
            }
        }, "Android");
        w.loadUrl("file:///android_asset/index.html");
    }

    String readText(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return new String(bo.toByteArray(), StandardCharsets.UTF_8);
    }

    double fetchPreviousClose(String ticker, long now) throws Exception {
        // VPS reference price is the exchange's previous-session reference price.
        try {
            JSONArray a = new JSONArray(httpGet("https://bgapidatafeed.vps.com.vn/getliststockdata/" + ticker));
            if (a.length() > 0) {
                JSONObject o = a.getJSONObject(0);
                double v = o.optDouble("r", 0);
                if (!(v > 0)) v = o.optDouble("referencePrice", 0);
                if (!(v > 0)) v = o.optDouble("refPrice", 0);
                if (v > 0) return v > 1000 ? v / 1000 : v;
            }
        } catch (Exception ignored) { }
        // Fallback: latest VNDirect daily close strictly before today's Vietnam date.
        java.text.SimpleDateFormat df = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US);
        df.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Ho_Chi_Minh"));
        long nowMs = now * 1000L;
        String today = df.format(new Date(nowMs));
        String from = df.format(new Date(nowMs - 14L * 86400000L));
        String u = "https://finfo-api.vndirect.com.vn/v4/stock_prices?sort=date&size=30&q=code:" + ticker + "~date:gte:" + from + "~date:lte:" + today;
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(8000); c.setReadTimeout(8000);
        c.setRequestProperty("User-Agent", "Mozilla/5.0");
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("Origin", "https://dstock.vndirect.com.vn");
        c.setRequestProperty("Referer", "https://dstock.vndirect.com.vn/");
        if (c.getResponseCode() != 200) throw new Exception("VNDirect history HTTP " + c.getResponseCode());
        JSONObject j = new JSONObject(readText(c.getInputStream()));
        c.disconnect();
        JSONArray data = j.optJSONArray("data");
        if (data == null) return 0;
        String bestDate = "";
        double best = 0;
        for (int i = 0; i < data.length(); i++) {
            JSONObject o = data.getJSONObject(i);
            String date = o.optString("date", "");
            if (date.length() >= 10) date = date.substring(0, 10);
            if (!date.isEmpty() && date.compareTo(today) < 0 && date.compareTo(bestDate) > 0) {
                double close = o.optDouble("close", o.optDouble("adClose", 0));
                if (close > 0) { bestDate = date; best = close; }
            }
        }
        return best > 1000 ? best / 1000 : best;
    }

    String httpGet(String u) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36");
        c.setRequestProperty("Accept", "application/json");
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        InputStream in = c.getInputStream();
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return new String(bo.toByteArray(), StandardCharsets.UTF_8);
    }

    double fetchQuote(String name, String t) throws Exception {
        long now = System.currentTimeMillis() / 1000;
        double v;
        if (name.equals("VPS")) {
            JSONArray a = new JSONArray(httpGet("https://bgapidatafeed.vps.com.vn/getliststockdata/" + t));
            JSONObject o = a.getJSONObject(0);
            v = o.optDouble("lastPrice", 0);
            if (!(v > 0)) v = o.optDouble("r", 0);
        } else if (name.equals("VNDirect")) {
            JSONObject j = new JSONObject(httpGet("https://finfo-api.vndirect.com.vn/v4/stock_prices?sort=date&size=1&q=code:" + t));
            v = j.getJSONArray("data").getJSONObject(0).getDouble("close");
        } else if (name.equals("DNSE")) {
            JSONObject j = new JSONObject(httpGet("https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?resolution=1D&symbol=" + t + "&from=" + (now - 864000) + "&to=" + now));
            JSONArray c = j.getJSONArray("c");
            v = c.getDouble(c.length() - 1);
        } else {
            JSONObject j = new JSONObject(httpGet("https://apipubaws.tcbs.com.vn/stock-insight/v1/stock/bars-long-term?type=stock&resolution=D&countBack=1&ticker=" + t + "&to=" + now));
            v = j.getJSONArray("data").getJSONObject(0).getDouble("close");
        }
        return v > 1000 ? v / 1000 : v;
    }

    @Override
    protected void onActivityResult(int code, int res, Intent data) {
        super.onActivityResult(code, res, data);
        if (res != RESULT_OK || data == null || data.getData() == null) return;
        Uri u = data.getData();
        try {
            if (code == SAVE) {
                OutputStream o = getContentResolver().openOutputStream(u, "wt");
                o.write(pending.getBytes(StandardCharsets.UTF_8));
                o.close();
                pending = "";
                w.evaluateJavascript("alert('Đã lưu file sao lưu')", null);
            } else if (code == OPEN) {
                InputStream in = getContentResolver().openInputStream(u);
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                in.close();
                String t = new String(bo.toByteArray(), StandardCharsets.UTF_8);
                w.evaluateJavascript("bkLoad(" + JSONObject.quote(t) + ")", null);
            }
        } catch (Exception e) {
            w.evaluateJavascript("alert('Không đọc hoặc ghi được file')", null);
        }
    }
}
