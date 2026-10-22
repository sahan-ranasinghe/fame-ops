// Whether a file the app kept is still on the phone, on its own (expo-file-system only): components/Photos.tsx reads it
// without loading lib/photos.ts, whose queue (sync, expo-sqlite) has no browser bundle (the design pages of src/design are
// drawn in the mobile website's e2e build). lib/photos.ts re-exports it.

import { File } from 'expo-file-system';

/** Whether a file the app kept is still on the phone (a thumbnail shown before its upload). */
export function fileExists(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}
