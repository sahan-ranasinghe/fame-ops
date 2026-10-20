// The two file steps of an office photo (office/media.ts) on a phone: a made file's size and its upload to a signed URL
// (expo-file-system). The browser has its own: mediaFile.web.ts.

import { File, UploadType } from 'expo-file-system';

/** The bytes of a file the image manipulator made. */
export async function fileBytes(uri: string): Promise<number> {
  return new File(uri).size ?? 0;
}

/** PUTs a file to a signed upload URL; the status and the answer's text. */
export async function putFile(url: string, uri: string, contentType: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const result = await new File(uri).upload(url, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, mimeType: contentType, headers });
  return { status: result.status, body: result.body };
}
