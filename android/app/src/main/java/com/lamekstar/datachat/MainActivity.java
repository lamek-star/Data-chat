package com.lamekstar.datachat;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Lets the in-app web view use passkeys (fingerprint / face unlock) for
     * datachat.harmongt.uk. Android only allows this for an app that the
     * domain lists in /.well-known/assetlinks.json with the app's release
     * signing key, so it works in release-signed builds.
     */
    @Override
    @SuppressLint({"RequiresFeature", "UnsafeOptInUsageError"})
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(
                webView.getSettings(), WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP);
        }
        openAppLink(getIntent());
    }

    /** A contact or locked-transfer link tapped while the app is already open. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openAppLink(intent);
    }

    /**
     * Opens https://datachat.harmongt.uk/?add=CODE (or ?seal=...) inside the
     * app's web view, so a contact QR scanned with the phone camera lands on
     * the "Add this contact?" screen. Only DataChat's own https links.
     */
    private void openAppLink(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null || !"https".equals(uri.getScheme()) || !APP_HOST.equals(uri.getHost())) return;
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) webView.post(() -> webView.loadUrl(uri.toString()));
    }

    private static final String APP_HOST = "datachat.harmongt.uk";
}
