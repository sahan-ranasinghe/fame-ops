// Hotfix O2-H2: lucide's icons are .mjs files Jest does not transform; a test needs no picture, only a component.
const React = require('react');
const Icon = () => null;
module.exports = Icon;
module.exports.default = Icon;
