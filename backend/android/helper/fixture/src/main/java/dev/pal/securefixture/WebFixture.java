package dev.pal.securefixture;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;

/** Offline staged login exercising editable WebView accessibility nodes. */
public final class WebFixture extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WebView web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        setContentView(web);
        web.loadDataWithBaseURL("https://android-fixture.example.test", "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><body><main id='stage'></main><script>"
            + "const roles=['username','password','code'], values=['pal-user-É漢字','pal-password-É漢字!72','936721'];let step=0;"
            + "function render(){if(step===3){document.querySelector('main').innerHTML='<h1>Authenticated</h1><p>Verified stages: username, password, transient code</p>';return;}"
            + "document.querySelector('main').innerHTML='<h1>'+roles[step]+'</h1><label>Account '+roles[step]+'<input style=\"display:block;font-size:24px\" aria-label=\"'+roles[step]+'\" type=\"text\"></label><button style=\"font-size:24px\" onclick=\"next()\">'+(step===2?'Verify':'Continue')+'</button>';}"
            + "function next(){if(document.querySelector('input').value===values[step]){step++;render();}}render();</script></body>", "text/html", "UTF-8", null);
    }
}
