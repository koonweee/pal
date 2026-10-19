// Load in the viewer's realm to reuse its existing UI and RFB connection.
const [{ default: UI }, { default: KeyTable }] = await Promise.all([
  import(new URL('./app/ui.js', document.baseURI).href),
  import(new URL('./core/input/keysym.js', document.baseURI).href),
]);

window.palDesktop = {
  get connected() {
    return UI.connected && !!UI.rfb && !UI.rfb.viewOnly;
  },
  paste(text) {
    if (!this.connected) throw new Error('Desktop disconnected');
    const rfb = UI.rfb;
    rfb.clipboardPasteFrom(text);
    // TigerVNC sets CLIPBOARD and PRIMARY; Shift+Insert works in terminals too.
    rfb.sendKey(KeyTable.XK_Shift_L, 'ShiftLeft', true);
    try {
      rfb.sendKey(KeyTable.XK_Insert, 'Insert');
    } finally {
      rfb.sendKey(KeyTable.XK_Shift_L, 'ShiftLeft', false);
    }
    rfb.focus();
  },
};

document.dispatchEvent(new Event('pal-desktop-ready'));
