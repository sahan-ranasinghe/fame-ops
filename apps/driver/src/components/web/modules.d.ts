// Declarations the browser maps need and the app does not carry (it has no @types/react-dom; react-dom is react-native-web's).
// A script file (no top-level import), so these declare the modules rather than add to them.

declare module '*.css';

declare module 'react-dom' {
  /** Render a pin into the element the map engine placed at a point. */
  export function createPortal(children: import('react').ReactNode, container: Element): import('react').ReactPortal;
}
