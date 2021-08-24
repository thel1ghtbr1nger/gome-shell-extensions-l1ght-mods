/* exported init buildPrefsWidget */

const { Gio, Gdk, Gtk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;
const N_ = e => e;
const cssData = `
   .no-border {
       border: none;
   }

   .border {
       border: 1px solid;
       border-radius: 3px;
       border-color: #b6b6b3;
       box-shadow: inset 0 0 0 1px rgba(74, 144, 217, 0);
       background-color: white;
   }

   .margins {
       padding-left: 8px;
       padding-right: 8px;
       padding-bottom: 8px;
   }

   .contents {
       padding: 20px;
   }

   .message-label {
       font-weight: bold;
   }
`;

var settings;

/** */
function init() {
    settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.heads-up-display');
    const cssProvider = new Gtk.CssProvider();
    cssProvider.load_from_data(cssData);

    const display = Gdk.Display.get_default();
    Gtk.StyleContext.add_provider_for_display(display, cssProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
}

/**
 * @returns {Gtk.Widget} - the prefs widget
 */
function buildPrefsWidget() {
    ExtensionUtils.initTranslations();

    const contents = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        visible: true,
    });

    contents.append(buildSwitch('show-when-locked', _('Show message when screen is locked')));
    contents.append(buildSwitch('show-when-unlocking', _('Show message on unlock screen')));
    contents.append(buildSwitch('show-when-unlocked', _('Show message when screen is unlocked')));
    contents.append(buildSpinButton('idle-timeout', _('Seconds after user goes idle before reshowing message')));
    contents.get_style_context().add_class('contents');

    const outerMessageBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 5,
        visible: true,
    });
    contents.append(outerMessageBox);

    const messageLabel = new Gtk.Label({
        label: 'Message',
        halign: Gtk.Align.START,
        visible: true,
    });
    messageLabel.get_style_context().add_class('message-label');
    outerMessageBox.append(messageLabel);

    const innerMessageBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 0,
        visible: true,
    });
    innerMessageBox.get_style_context().add_class('border');
    outerMessageBox.append(innerMessageBox);

    innerMessageBox.append(buildEntry('message-heading', _('Message Heading')));
    innerMessageBox.append(buildTextView('message-body'));
    return contents;
}

/**
 * @param {string} key - GSetting to bind the text to
 *
 * @returns {Gtk.Widget} - a text view widget
 */
function buildTextView(key) {
    const textView = new Gtk.TextView({
        accepts_tab: false,
        visible: true,
        wrap_mode: Gtk.WrapMode.WORD,
    });

    settings.bind(key, textView.get_buffer(), 'text', Gio.SettingsBindFlags.DEFAULT);

    const scrolledWindow = new Gtk.ScrolledWindow({
        hexpand: true,
        vexpand: true,
        visible: true,
    });
    const styleContext = scrolledWindow.get_style_context();
    styleContext.add_class('margins');

    scrolledWindow.set_child(textView);
    return scrolledWindow;
}

/**
 * @param {string} key - GSetting to bind the text to
 * @param {string} labelText - place holder text for entry
 *
 * @returns {Gtk.Widget} - an entry widget
 */
function buildEntry(key, labelText) {
    const entry = new Gtk.Entry({
        placeholder_text: labelText,
        visible: true,
    });
    const styleContext = entry.get_style_context();
    styleContext.add_class('no-border');
    settings.bind(key, entry, 'text', Gio.SettingsBindFlags.DEFAULT);

    entry.get_settings()['gtk-entry-select-on-focus'] = false;

    return entry;
}

/**
 * @param {string} key - GSetting to bind the value to
 * @param {string} labelText - label
 *
 * @returns {Gtk.Widget} - a spin button widget
 */
function buildSpinButton(key, labelText) {
    const hbox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 10,
        visible: true,
    });
    const label = new Gtk.Label({
        hexpand: true,
        label: labelText,
        visible: true,
        xalign: 0,
    });
    const adjustment = new Gtk.Adjustment({
        value: 0,
        lower: 0,
        upper: 2147483647,
        step_increment: 1,
        page_increment: 60,
        page_size: 60,
    });
    const spinButton = new Gtk.SpinButton({
        adjustment,
        climb_rate: 1.0,
        digits: 0,
        max_width_chars: 3,
        visible: true,
        width_chars: 3,
    });
    settings.bind(key, spinButton, 'value', Gio.SettingsBindFlags.DEFAULT);
    hbox.append(label);
    hbox.append(spinButton);
    return hbox;
}

/**
 * @param {string} key - GSetting to bind the value to
 * @param {string} labelText - label
 *
 * @returns {Gtk.Widget} - a switch widget
 */
function buildSwitch(key, labelText) {
    const hbox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 10,
        visible: true,
    });
    const label = new Gtk.Label({
        hexpand: true,
        label: labelText,
        visible: true,
        xalign: 0,
    });
    const switcher = new Gtk.Switch({
        active: settings.get_boolean(key),
    });
    settings.bind(key, switcher, 'active', Gio.SettingsBindFlags.DEFAULT);
    hbox.append(label);
    hbox.append(switcher);
    return hbox;
}
