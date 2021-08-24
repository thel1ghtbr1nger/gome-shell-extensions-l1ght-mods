/* exported init enable disable */

const {
    GObject, Meta,
} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Main = imports.ui.main;
const Layout = imports.ui.layout;
const HeadsUpMessage = Me.imports.headsUpMessage;

const _ = ExtensionUtils.gettext;

var HeadsUpConstraint = GObject.registerClass({
    Properties: {
        'offset': GObject.ParamSpec.int(
            'offset', 'Offset', 'offset',
            GObject.ParamFlags.READABLE | GObject.ParamFlags.WRITABLE,
            -1, 0, -1),
        'active': GObject.ParamSpec.boolean(
            'active', 'Active', 'active',
            GObject.ParamFlags.READABLE | GObject.ParamFlags.WRITABLE,
            true),
    },
}, class HeadsUpConstraint extends Layout.MonitorConstraint {
    _init(props) {
        super._init(props);
        this._offset = 0;
        this._active = true;
    }

    get offset() {
        return this._offset;
    }

    set offset(o) {
        this._offset = o;
    }

    get active() {
        return this._active;
    }

    set active(a) {
        this._active = a;
    }

    vfunc_update_allocation(actor, actorBox) {
        if (!Main.layoutManager.primaryMonitor)
            return;

        if (!this.active)
            return;

        if (actor.has_allocation())
            return;

        const workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        actorBox.init_rect(workArea.x, workArea.y + this.offset, workArea.width, workArea.height - this.offset);
    }
});

class Extension {
    constructor() {
        ExtensionUtils.initTranslations();
    }

    enable() {
        this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.heads-up-display');
        this._settingsChangedId = this._settings.connect('changed', this._updateMessage.bind(this));

        this._idleMonitor = global.backend.get_core_idle_monitor();
        this._messageInhibitedUntilIdle = false;
        this._oldMapWindow = Main.wm._mapWindow;
        Main.wm._mapWindow = this._mapWindow;
        this._windowManagerMapId = global.window_manager.connect('map', this._onWindowMap.bind(this));

        if (Main.layoutManager._startingUp)
            this._startupCompleteId = Main.layoutManager.connect('startup-complete', this._onStartupComplete.bind(this));
        else
            this._onStartupComplete(this);
    }

    disable() {
        this._dismissMessage();

        this._stopWatchingForIdle();

        if (this._sessionModeUpdatedId) {
            Main.sessionMode.disconnect(this._sessionModeUpdatedId);
            this._sessionModeUpdatedId = 0;
        }

        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = 0;
        }

        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = 0;
        }

        if (this._screenShieldVisibleId) {
            Main.screenShield._dialog._clock.disconnect(this._screenShieldVisibleId);
            this._screenShieldVisibleId = 0;
        }

        if (this._panelConnectionId) {
            Main.layoutManager.panelBox.disconnect(this._panelConnectionId);
            this._panelConnectionId = 0;
        }

        if (this._oldMapWindow) {
            Main.wm._mapWindow = this._oldMapWindow;
            this._oldMapWindow = null;
        }

        if (this._windowManagerMapId) {
            global.window_manager.disconnect(this._windowManagerMapId);
            this._windowManagerMapId = 0;
        }

        if (this._startupCompleteId) {
            Main.layoutManager.disconnect(this._startupCompleteId);
            this._startupCompleteId = 0;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
    }

    _onWindowMap(shellwm, actor) {
        const windowObject = actor.meta_window;
        const windowType = windowObject.get_window_type();

        if (windowType !== Meta.WindowType.NORMAL)
            return;

        if (!this._message || !this._message.visible)
            return;

        const messageRect = new Meta.Rectangle({ x: this._message.x, y: this._message.y, width: this._message.width, height: this._message.height });
        const windowRect = windowObject.get_frame_rect();

        if (windowRect.intersect(messageRect))
            windowObject.move_frame(false, windowRect.x, this._message.y + this._message.height);
    }

    _onStartupComplete() {
        this._overviewShowingId = Main.overview.connect('showing', this._updateMessage.bind(this));
        this._overviewHiddenId = Main.overview.connect('hidden', this._updateMessage.bind(this));
        this._panelConnectionId = Main.layoutManager.panelBox.connect('notify::visible', this._updateMessage.bind(this));
        this._sessionModeUpdatedId = Main.sessionMode.connect('updated', this._onSessionModeUpdated.bind(this));

        this._updateMessage();
    }

    _onSessionModeUpdated() {
        if (!Main.sessionMode.hasWindows)
            this._messageInhibitedUntilIdle = false;

        const dialog = Main.screenShield._dialog;
        if (!Main.sessionMode.isGreeter && dialog && !this._screenShieldVisibleId) {
            this._screenShieldVisibleId = dialog._clock.connect('notify::visible', this._updateMessage.bind(this));
            this._screenShieldDestroyId = dialog._clock.connect('destroy', () => {
                this._screenShieldVisibleId = 0;
                this._screenShieldDestroyId = 0;
            });
        }
        this._updateMessage();
    }

    _stopWatchingForIdle() {
        if (this._idleWatchId) {
            this._idleMonitor.remove_watch(this._idleWatchId);
            this._idleWatchId = 0;
        }

        if (this._idleTimeoutChangedId) {
            this._settings.disconnect(this._idleTimeoutChangedId);
            this._idleTimeoutChangedId = 0;
        }
    }

    _onIdleTimeoutChanged() {
        this._stopWatchingForIdle();
        this._messageInhibitedUntilIdle = false;
    }

    _onUserIdle() {
        this._messageInhibitedUntilIdle = false;
        this._updateMessage();
    }

    _watchForIdle() {
        this._stopWatchingForIdle();

        const idleTimeout = this._settings.get_uint('idle-timeout');

        this._idleTimeoutChangedId = this._settings.connect('changed::idle-timeout', this._onIdleTimeoutChanged.bind(this));
        this._idleWatchId = this._idleMonitor.add_idle_watch(idleTimeout * 1000, this._onUserIdle.bind(this));
    }

    _updateMessage() {
        if (this._messageInhibitedUntilIdle) {
            if (this._message)
                this._dismissMessage();
            return;
        }

        this._stopWatchingForIdle();

        if (Main.sessionMode.hasOverview && Main.overview.visible) {
            this._dismissMessage();
            return;
        }

        if (!Main.layoutManager.panelBox.visible) {
            this._dismissMessage();
            return;
        }

        let supportedModes = [];

        if (this._settings.get_boolean('show-when-unlocked'))
            supportedModes.push('user');

        if (this._settings.get_boolean('show-when-unlocking') ||
            this._settings.get_boolean('show-when-locked'))
            supportedModes.push('unlock-dialog');

        if (this._settings.get_boolean('show-on-login-screen'))
            supportedModes.push('gdm');

        if (!supportedModes.includes(Main.sessionMode.currentMode) &&
            !supportedModes.includes(Main.sessionMode.parentMode)) {
            this._dismissMessage();
            return;
        }

        if (Main.sessionMode.currentMode === 'unlock-dialog') {
            const dialog = Main.screenShield._dialog;
            if (!this._settings.get_boolean('show-when-locked')) {
                if (dialog._clock.visible) {
                    this._dismissMessage();
                    return;
                }
            }

            if (!this._settings.get_boolean('show-when-unlocking')) {
                if (!dialog._clock.visible) {
                    this._dismissMessage();
                    return;
                }
            }
        }

        const heading = this._settings.get_string('message-heading');
        const body = this._settings.get_string('message-body');

        if (!heading && !body) {
            this._dismissMessage();
            return;
        }

        if (!this._message) {
            this._message = new HeadsUpMessage.HeadsUpMessage(heading, body);

            this._message.connect('notify::allocation', this._adaptSessionForMessage.bind(this));
            this._message.connect('clicked', this._onMessageClicked.bind(this));
        }

        this._message.reactive = true;
        this._message.track_hover = true;

        this._message.setHeading(heading);
        this._message.setBody(body);

        if (!Main.sessionMode.hasWindows) {
            this._message.track_hover = false;
            this._message.reactive = false;
        }
    }

    _onMessageClicked() {
        if (!Main.sessionMode.hasWindows)
            return;

        this._watchForIdle();
        this._messageInhibitedUntilIdle = true;
        this._updateMessage();
    }

    _dismissMessage() {
        if (!this._message)
            return;

        this._message.visible = false;
        this._message.destroy();
        this._message = null;
        this._resetMessageTray();
        this._resetLoginDialog();
    }

    _resetMessageTray() {
        if (!Main.messageTray)
            return;

        if (this._updateMessageTrayId) {
            global.stage.disconnect(this._updateMessageTrayId);
            this._updateMessageTrayId = 0;
        }

        if (this._messageTrayConstraint) {
            Main.messageTray.remove_constraint(this._messageTrayConstraint);
            this._messageTrayConstraint = null;
        }
    }

    _alignMessageTray() {
        if (!Main.messageTray)
            return;

        if (!this._message || !this._message.visible) {
            this._resetMessageTray();
            return;
        }

        if (this._updateMessageTrayId)
            return;

        this._updateMessageTrayId = global.stage.connect('before-update', () => {
            if (!this._messageTrayConstraint) {
                this._messageTrayConstraint = new HeadsUpConstraint({ primary: true });

                Main.layoutManager.panelBox.bind_property('visible',
                    this._messageTrayConstraint, 'active',
                    GObject.BindingFlags.SYNC_CREATE);

                Main.messageTray.add_constraint(this._messageTrayConstraint);
            }

            const panelBottom = Main.layoutManager.panelBox.y + Main.layoutManager.panelBox.height;
            const messageBottom = this._message.y + this._message.height;

            this._messageTrayConstraint.offset = messageBottom - panelBottom;
            global.stage.disconnect(this._updateMessageTrayId);
            this._updateMessageTrayId = 0;
        });
    }

    _resetLoginDialog() {
        if (!Main.sessionMode.isGreeter)
            return;

        if (!Main.screenShield || !Main.screenShield._dialog)
            return;

        const dialog = Main.screenShield._dialog;

        if (this._authPromptAllocatedId) {
            dialog.disconnect(this._authPromptAllocatedId);
            this._authPromptAllocatedId = 0;
        }

        if (this._updateLoginDialogId) {
            global.stage.disconnect(this._updateLoginDialogId);
            this._updateLoginDialogId = 0;
        }

        if (this._loginDialogConstraint) {
            dialog.remove_constraint(this._loginDialogConstraint);
            this._loginDialogConstraint = null;
        }
    }

    _adaptLoginDialogForMessage() {
        if (!Main.sessionMode.isGreeter)
            return;

        if (!Main.screenShield || !Main.screenShield._dialog)
            return;

        if (!this._message || !this._message.visible) {
            this._resetLoginDialog();
            return;
        }

        const dialog = Main.screenShield._dialog;

        if (this._updateLoginDialogId)
            return;

        this._updateLoginDialogId = global.stage.connect('before-update', () => {
            let messageHeight = this._message.y + this._message.height;
            if (dialog._logoBin.visible)
                messageHeight -= dialog._logoBin.height;

            if (!this._logindDialogConstraint) {
                this._loginDialogConstraint = new HeadsUpConstraint({ primary: true });
                dialog.add_constraint(this._loginDialogConstraint);
            }

            this._loginDialogConstraint.offset = messageHeight;

            global.stage.disconnect(this._updateLoginDialogId);
            this._updateLoginDialogId = 0;
        });
    }

    _adaptSessionForMessage() {
        this._alignMessageTray();

        if (Main.sessionMode.isGreeter) {
            this._adaptLoginDialogForMessage();
            if (!this._authPromptAllocatedId) {
                const dialog = Main.screenShield._dialog;
                this._authPromptAllocatedId = dialog._authPrompt.connect('notify::allocation', this._adaptLoginDialogForMessage.bind(this));
            }
        }
    }
}

/**
 * @returns {Extension} - the extension's state object
 */
function init() {
    return new Extension();
}
