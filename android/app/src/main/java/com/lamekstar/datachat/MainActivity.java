package com.lamekstar.datachat;

import android.annotation.SuppressLint;
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
    }
}
