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
                i.setType("application/json");
                i.putExtra(Intent.EXTRA_TITLE, "so-chung-khoan-" + new SimpleDateFormat("yyyyMMdd", Locale.US).format(new Date()) + ".json");
                startActivityForResult(i, SAVE);
            }
            @JavascriptInterface
            public void open() {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                startActivityForResult(i, OPEN);
            }
        }, "Android");
        w.loadUrl("file:///android_asset/index.html");
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
