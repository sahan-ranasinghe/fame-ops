// TEMPORARY (O4 spike, replaced by the browser map before any checkpoint): the web build's DriversMap, so the bundle can be
// checked past the maps. test:web fails while this file says TEMPORARY.
import { View } from 'react-native';

export function DriversMap(_props: Record<string, unknown>) {
  return <View style={{ flex: 1, minHeight: 200, backgroundColor: '#e9e7e0' }} />;
}
