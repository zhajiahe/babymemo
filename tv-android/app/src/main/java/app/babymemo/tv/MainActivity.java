package app.babymemo.tv;

import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.net.Uri;

public final class MainActivity extends Activity {
    private WebView browser;
    private final String baseHost = Uri.parse(BuildConfig.TV_URL).getHost();

    private boolean allowed(Uri uri) {
        return "https".equals(uri.getScheme()) && baseHost.equals(uri.getHost())
            && (uri.getPath().equals("/tv") || uri.getPath().startsWith("/tv/"));
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        browser = new WebView(this);
        browser.setFocusable(true);
        browser.setFocusableInTouchMode(true);
        browser.getSettings().setJavaScriptEnabled(true);
        browser.getSettings().setDomStorageEnabled(true);
        browser.getSettings().setAllowFileAccess(false);
        browser.getSettings().setAllowContentAccess(false);
        browser.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        browser.getSettings().setSupportMultipleWindows(false);
        browser.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        browser.getSettings().setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false);
        browser.setWebChromeClient(new WebChromeClient());
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !allowed(request.getUrl());
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) Toast.makeText(MainActivity.this,
                    "BabyMemo 无法连接，请检查电视网络。", Toast.LENGTH_LONG).show();
            }
        });
        setContentView(browser);
        browser.loadUrl(BuildConfig.TV_URL);
        browser.requestFocus();
    }

    @Override public void onBackPressed() {
        if (browser != null) {
            browser.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));", null);
        } else {
            super.onBackPressed();
        }
    }
    @Override protected void onDestroy() {
        if(browser != null){browser.destroy();browser=null;}
        super.onDestroy();
    }
}
