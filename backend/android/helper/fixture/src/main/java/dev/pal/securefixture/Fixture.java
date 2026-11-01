package dev.pal.securefixture;

import android.app.Activity;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Synthetic acceptance target. Credential values are never echoed or persisted. */
public final class Fixture extends Activity {
    private int stage;
    private boolean username, password;
    private int saves;
    @Override public void onCreate(Bundle state) { super.onCreate(state); screen(); }
    private void screen() {
        LinearLayout layout = new LinearLayout(this); layout.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS); layout.setOrientation(LinearLayout.VERTICAL); layout.setPadding(36, 90, 36, 20);
        TextView heading = new TextView(this); heading.setText(stage == 3 ? "Authenticated — Pal secure fixture" : "Pal secure fixture — " + new String[]{"Username", "Password", "Verification code"}[stage]); heading.setTextSize(23); layout.addView(heading);
        if (stage < 3) {
            EditText field = new EditText(this); field.setId(100 + stage); field.setSingleLine(true);
            field.setHint(new String[]{"Email or username", "Password", "Verification code"}[stage]);
            field.setInputType(stage == 1 ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD : stage == 2 ? InputType.TYPE_CLASS_NUMBER : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
            field.setAutofillHints(stage == 0 ? View.AUTOFILL_HINT_USERNAME : stage == 1 ? View.AUTOFILL_HINT_PASSWORD : "smsOTPCode"); layout.addView(field);
            Button next = new Button(this); next.setText(stage == 2 ? "Verify" : "Continue");
            next.setOnClickListener(view -> {
                boolean valid = field.getText().toString().equals(new String[]{"pal-user-É漢字", "pal-password-É漢字!72", "936721"}[stage]);
                if (stage == 0) username = valid;
                if (stage == 1) password = valid;
                if (valid && (stage < 2 || username && password)) { field.setText(""); stage++; screen(); }
            }); layout.addView(next);
        } else {
            TextView verified = new TextView(this); verified.setText("Verified stages: username, password, transient code"); layout.addView(verified);
            EditText reference = new EditText(this); reference.setSingleLine(true); reference.setHint("Draft reference"); layout.addView(reference);
            TextView receipt = new TextView(this);
            Button save = new Button(this); save.setText("Save draft"); save.setOnClickListener(view -> {
                if (reference.getText().toString().equals("PAL-DRAFT-42")) { saves++; receipt.setText("Draft saved: PAL-DRAFT-42; saves: " + saves); }
            }); layout.addView(save); layout.addView(receipt);
            Button reset = new Button(this); reset.setText("Start again"); reset.setOnClickListener(view -> { stage = 0; saves = 0; username = false; password = false; screen(); }); layout.addView(reset);
        }
        // Readonly editable semantics can expose a text child. Mask descendants.
        LinearLayout privateRegion = new LinearLayout(this) {
            @Override public void onInitializeAccessibilityNodeInfo(android.view.accessibility.AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(info); info.setEditable(true);
            }
        };
        privateRegion.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        TextView child = new TextView(this); child.setText("PRIVATE_READONLY_CHILD_CANARY"); privateRegion.addView(child); layout.addView(privateRegion);
        setContentView(layout);
    }
}
