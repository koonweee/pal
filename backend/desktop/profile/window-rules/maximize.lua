-- Apply once when a normal app window opens. Xfwm respects workspace margins.
-- Leave dialogs, utility windows, the dock, and explicit fullscreen alone.
if get_window_type() == "WINDOW_TYPE_NORMAL" and not get_window_fullscreen() then
    maximize()
end
