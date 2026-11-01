package dev.pal.secureentry;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.Bundle;
import android.os.Build;
import android.os.Process;
import android.util.Base64;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

/** Private ADB bridge. No values, requests or exceptions are written to logs. */
public final class Bridge extends Instrumentation {
    private UiAutomation automation;
    private final String session = UUID.randomUUID().toString();
    private final AtomicLong events = new AtomicLong();
    private final AtomicLong windows = new AtomicLong();
    private final Map<String, Bound> inputs = new HashMap<>();
    private final Map<String, Bound> targets = new HashMap<>();
    private final SecureRandom random = new SecureRandom();
    private boolean stopping;
    private String socketName;
    private byte[] authKey;
    private String phase = "request";

    private static final class Bound {
        AccessibilityNodeInfo node;
        AccessibilityNodeInfo root;
        String app;
        String id;
        boolean password;
        int inputType;
        Rect rect;
        long window;
        long at;
        Bound(AccessibilityNodeInfo node, AccessibilityNodeInfo root, long window) {
            this.node = AccessibilityNodeInfo.obtain(node);
            this.root = AccessibilityNodeInfo.obtain(root);
            this.app = string(node.getPackageName());
            this.id = string(node.getViewIdResourceName());
            this.password = node.isPassword();
            this.inputType = node.getInputType();
            this.rect = bounds(node);
            this.window = window;
            this.at = System.currentTimeMillis();
        }
        void close() { node.recycle(); root.recycle(); }
    }

    @Override public void onCreate(Bundle args) {
        super.onCreate(args);
        socketName = args.getString("socket", "");
        if (!socketName.matches("pal_secure_[0-9a-f]{32}")) { finish(1, new Bundle()); return; }
        start();
    }
    @Override public void onStart() {
        try {
            java.nio.file.Path keyPath = new java.io.File(getTargetContext().getCacheDir(), "bridge-key").toPath();
            authKey = Files.readAllBytes(keyPath);
            Files.deleteIfExists(keyPath);
            if (authKey.length != 32) throw new IllegalStateException();
        } catch (Throwable error) { finish(1, new Bundle()); return; }
        try (LocalServerSocket server = new LocalServerSocket(socketName)) {
            while (!stopping) {
                try (LocalSocket socket = server.accept()) {
                    // ADB forwarding connects as adbd (shell). Other installed apps
                    // cannot invoke this bridge, even if they know its socket name.
                    int uid = socket.getPeerCredentials().getUid();
                    if (uid != 2000 && uid != 0) continue;
                    socket.setSoTimeout(15000);
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                    String hello = reader.readLine();
                    if (hello == null || hello.length() > 128) continue;
                    String challenge = new JSONObject(hello).getString("hello");
                    if (!challenge.matches("[0-9a-f]{32}")) continue;
                    OutputStreamWriter writer = new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8);
                    writer.write(new JSONObject().put("mac", mac("hello", challenge, "")).toString()); writer.write("\n"); writer.flush();
                    StringBuilder line = new StringBuilder();
                    int next;
                    while ((next = reader.read()) != -1 && next != '\n') {
                        if (line.length() >= 65536) throw new IllegalArgumentException();
                        line.append((char) next);
                    }
                    JSONObject envelope = new JSONObject(line.toString());
                    String nonce = envelope.getString("nonce");
                    String body = envelope.getString("body");
                    if (!nonce.equals(challenge) || !MessageDigest.isEqual(mac("request", nonce, body).getBytes(StandardCharsets.US_ASCII), envelope.getString("mac").getBytes(StandardCharsets.US_ASCII))) continue;
                    JSONObject output;
                    try { output = execute(new JSONObject(body)); }
                    catch (Throwable error) { output = new JSONObject().put("status", "error").put("code", "unavailable_or_stale").put("phase", phase).put("errorType", error.getClass().getSimpleName()); }
                    line.setLength(0);
                    String response = output.toString();
                    writer.write(new JSONObject().put("body", response).put("mac", mac("response", nonce, response)).toString()); writer.write("\n"); writer.flush();
                } catch (Throwable error) { /* Never log request or exception material. */ }
            }
        } catch (Throwable error) { /* A fixed failure is observable through the socket readiness probe. */ }
        clear(inputs); clear(targets);
        java.util.Arrays.fill(authKey, (byte) 0);
        finish(0, new Bundle());
    }

    private void connect() {
        if (automation != null) return;
        automation = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
        AccessibilityServiceInfo info = automation.getServiceInfo();
        info.eventTypes = AccessibilityEvent.TYPES_ALL_MASK;
        info.flags |= AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS | AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS | AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
        automation.setServiceInfo(info);
        automation.setOnAccessibilityEventListener(event -> {
            events.incrementAndGet();
            if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || event.getEventType() == AccessibilityEvent.TYPE_WINDOWS_CHANGED) windows.incrementAndGet();
        });
    }

    private JSONObject execute(JSONObject request) throws Exception {
        phase = "request";
        String action = request.getString("action");
        if (action.equals("ping")) return new JSONObject().put("status", "ready").put("session", session);
        if (action.equals("stop")) { stopping = true; return new JSONObject().put("status", "stopped"); }
        phase = "connect";
        connect();
        if (action.equals("inspect") || action.equals("observe")) return inspect(action.equals("inspect"));
        if (action.equals("resolve")) {
            Bound bound = targets.get(request.getString("ref"));
            current(bound, null);
            return new JSONObject().put("x", bound.rect.centerX()).put("y", bound.rect.centerY());
        }
        if (action.equals("validate") || action.equals("fill")) {
            if (!session.equals(request.getString("session"))) throw new IllegalStateException();
            JSONArray fields = request.getJSONArray("fields");
            if (fields.length() == 0 || fields.length() > 64) throw new IllegalArgumentException();
            for (int i = 0; i < fields.length(); i++) {
                JSONObject field = fields.getJSONObject(i);
                Bound bound = inputs.get(field.getString("ref"));
                current(bound, field.getString("role"));
                if (!bound.app.equals(request.getString("packageName"))) throw new IllegalStateException();
            }
            if (action.equals("fill")) {
                int written = 0;
                try {
                    for (int i = 0; i < fields.length(); i++) {
                        JSONObject field = fields.getJSONObject(i);
                        Bound bound = inputs.get(field.getString("ref"));
                        String value = field.getString("value");
                        if (value.isEmpty() || value.length() > 4096 || (bound.node.getMaxTextLength() > 0 && value.length() > bound.node.getMaxTextLength())) throw new IllegalArgumentException();
                    }
                    for (int i = 0; i < fields.length(); i++) {
                        JSONObject field = fields.getJSONObject(i);
                        Bound bound = inputs.get(field.getString("ref"));
                        current(bound, field.getString("role"));
                        Bundle args = new Bundle();
                        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, field.getString("value"));
                        boolean done = bound.node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_TEXT.getId(), args);
                        args.clear(); field.remove("value");
                        if (!done) throw new IllegalStateException();
                        written++;
                    }
                } catch (Throwable error) {
                    return new JSONObject().put("status", "error").put("code", written > 0 ? "partial_fill" : "unavailable_or_stale");
                } finally {
                    for (int i = 0; i < fields.length(); i++) fields.getJSONObject(i).remove("value");
                }
            }
            return new JSONObject().put("status", action.equals("fill") ? "filled" : "valid");
        }
        throw new IllegalArgumentException();
    }

    private void current(Bound bound, String role) throws Exception {
        if (bound == null || System.currentTimeMillis() - bound.at > 600000 || bound.window != windows.get()) throw new IllegalStateException();
        if (!bound.root.refresh() || !bound.node.refresh()) throw new IllegalStateException();
        AccessibilityNodeInfo root = automation.getRootInActiveWindow();
        if (root == null) throw new IllegalStateException();
        try {
            if (!root.equals(bound.root) || !bound.app.equals(string(root.getPackageName())) || !bound.app.equals(string(bound.node.getPackageName())) || !bound.id.equals(string(bound.node.getViewIdResourceName())) || !bound.rect.equals(bounds(bound.node)) || !bound.node.isEnabled() || !bound.node.isVisibleToUser()) throw new IllegalStateException();
            if (role != null) {
                if (!editable(bound.node) || bound.password != bound.node.isPassword() || bound.inputType != bound.node.getInputType()) throw new IllegalStateException();
                if (!role.equals("username") && !role.equals("password") && !role.equals("code")) throw new IllegalArgumentException();

            }
        } finally { root.recycle(); }
    }

    private JSONObject inspect(boolean bind) throws Exception {
        phase = "idle";
        if (Build.VERSION.SDK_INT >= 34) automation.clearCache();
        try { automation.waitForIdle(150, 1500); } catch (java.util.concurrent.TimeoutException ignored) { }
        if (bind) clear(inputs);
        clear(targets);
        long version = events.get();
        long window = windows.get();
        phase = "root";
        AccessibilityNodeInfo root = automation.getRootInActiveWindow();
        if (root == null) throw new IllegalStateException();
        Bitmap bitmap = null;
        try {
            AccessibilityWindowInfo active = root.getWindow();
            if (active == null) throw new IllegalStateException();
            boolean application = active.getType() == AccessibilityWindowInfo.TYPE_APPLICATION;
            active.recycle();
            if (!application) throw new IllegalStateException();
            String app = string(root.getPackageName());
            phase = "identity";
            JSONObject identity = identity(app);
            JSONArray fields = new JSONArray();
            JSONArray elements = new JSONArray();
            phase = "walk";
            walk(root, root, false, bind, window, fields, elements, 0);
            phase = "screenshot";
            bitmap = automation.takeScreenshot();
            if (bitmap == null) throw new IllegalStateException();
            phase = "fence";
            if (version != events.get() || window != windows.get() || !root.refresh()) throw new IllegalStateException();
            int width = bitmap.getWidth(), height = bitmap.getHeight();
            if (Math.max(width, height) > 1280) {
                float ratio = 1280f / Math.max(width, height);
                Bitmap scaled = Bitmap.createScaledBitmap(bitmap, Math.round(width * ratio), Math.round(height * ratio), true);
                bitmap.recycle(); bitmap = scaled;
            }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
            return new JSONObject().put("status", "ready").put("session", session).put("identity", identity).put("inputs", fields).put("elements", elements).put("image", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)).put("width", width).put("height", height).put("imageWidth", bitmap.getWidth()).put("imageHeight", bitmap.getHeight());
        } finally { root.recycle(); if (bitmap != null) bitmap.recycle(); }
    }

    private void walk(AccessibilityNodeInfo node, AccessibilityNodeInfo root, boolean inSensitive, boolean bind, long window, JSONArray fields, JSONArray elements, int depth) throws Exception {
        if (depth > 60 || elements.length() > 3000) throw new IllegalStateException();
        boolean sensitive = node.isEditable() || node.isPassword() || node.getInputType() != 0 || string(node.getClassName()).contains("EditText");
        boolean privateField = inSensitive || sensitive;
        Rect rect = bounds(node);
        if (node.isVisibleToUser() && !rect.isEmpty()) {
            String ref = "@a" + targets.size() + "-" + nonce();
            targets.put(ref, new Bound(node, root, window));
            String label = privateField ? string(node.getHintText()) : node.getChildCount() == 0 ? string(node.getContentDescription()) : "";
            String text = privateField || node.getChildCount() > 0 ? "" : string(node.getText());
            elements.put(new JSONObject().put("ref", ref).put("type", string(node.getClassName())).put("text", text).put("label", label).put("identifier", string(node.getViewIdResourceName())).put("focused", node.isFocused()).put("enabled", node.isEnabled()).put("rect", rect(rect)));
            if (bind && !inSensitive && editable(node) && node.isEnabled() && fields.length() < 200 && string(node.getPackageName()).equals(string(root.getPackageName()))) {
                String input = "i" + (fields.length() + 1) + "-" + nonce();
                inputs.put(input, new Bound(node, root, window));
                fields.put(new JSONObject().put("ref", input).put("type", node.isPassword() ? "password" : "text").put("password", node.isPassword()).put("inputType", node.getInputType()).put("label", label).put("identifier", string(node.getViewIdResourceName())).put("maxLength", node.getMaxTextLength()).put("rect", rect(rect)));
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) { try { walk(child, root, privateField, bind, window, fields, elements, depth + 1); } finally { child.recycle(); } }
        }
    }

    private JSONObject identity(String app) throws Exception {
        return new JSONObject().put("packageName", app);
    }
    private String mac(String direction, String nonce, String body) throws Exception {
        Mac hmac = Mac.getInstance("HmacSHA256");
        hmac.init(new SecretKeySpec(authKey, "HmacSHA256"));
        byte[] bytes = hmac.doFinal((direction + "\n" + nonce + "\n" + body).getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(); for (byte value : bytes) hex.append(String.format("%02x", value & 255));
        return hex.toString();
    }
    private static boolean editable(AccessibilityNodeInfo node) { return node.isEditable() && node.getActionList().contains(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_TEXT); }
    private static String string(CharSequence value) { return value == null ? "" : value.toString().substring(0, Math.min(value.length(), 240)); }
    private static Rect bounds(AccessibilityNodeInfo node) { Rect rect = new Rect(); node.getBoundsInScreen(rect); return rect; }
    private static JSONObject rect(Rect rect) throws Exception { return new JSONObject().put("x", rect.left).put("y", rect.top).put("width", rect.width()).put("height", rect.height()); }
    private String nonce() { byte[] bytes = new byte[12]; random.nextBytes(bytes); return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    private static void clear(Map<String, Bound> map) { for (Bound bound : map.values()) bound.close(); map.clear(); }
}
