// Config plugin (release 1.4.0, docs/release-1.4.0.md item 6): the app is light on purpose for now, also on a phone in dark
// mode. app.json's userInterfaceStyle "light" already keeps Android's own dark theme out; what can still darken it is force
// dark (Android 10+ "Override force-dark", and the OEM skins' "dark mode for third-party apps": ColorOS / realme UI, MIUI /
// HyperOS, some Samsung and vivo builds), which recolours a light app's views unless its theme refuses. This sets
// android:forceDarkAllowed="false" on the app's theme (AppTheme in res/values/styles.xml).

const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

/** The styles with forceDarkAllowed false on AppTheme (pure, for test:build). */
function lightOnlyStyles(styles) {
  return AndroidConfig.Styles.assignStylesValue(styles, {
    add: true,
    parent: AndroidConfig.Styles.getAppThemeGroup(),
    name: 'android:forceDarkAllowed',
    value: 'false',
  });
}

module.exports = function withLightOnly(config) {
  return withAndroidStyles(config, (c) => {
    c.modResults = lightOnlyStyles(c.modResults);
    return c;
  });
};

module.exports.lightOnlyStyles = lightOnlyStyles;
