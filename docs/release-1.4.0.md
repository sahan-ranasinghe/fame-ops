# Release 1.4.0 (native): what waits for the next build

Things a JavaScript-only round could not do, because they need a native module or a native change. They go in the next
build (a new runtime), never through an EAS update to 1.3.0.

- **expo-clipboard** (Hotfix O2-H2, Part 1c, 20 October 2026): the crash screen's "Show details → Copy" uses Android's
  share sheet (`Share.share`) because 1.3.0 has no clipboard module. With expo-clipboard, Copy puts the details on the
  clipboard and says "Copied" in the snackbar (WhatsApp's "Message copied"); the share sheet stays as "Share".
