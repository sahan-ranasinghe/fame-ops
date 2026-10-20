// The two file steps of an office photo (office/media.ts) in a browser (the mobile website, O4): expo-file-system has no web
// version (its upload answers status 0), so the made picture (a blob: or data: URL from the image manipulator) is read
// with fetch and PUT with fetch.

async function blobOf(uri: string): Promise<Blob> {
  return (await fetch(uri)).blob();
}

/** The bytes of a picture the image manipulator made. */
export async function fileBytes(uri: string): Promise<number> {
  return (await blobOf(uri)).size;
}

/** PUTs a picture to a signed upload URL; the status and the answer's text. */
export async function putFile(url: string, uri: string, contentType: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': contentType }, body: await blobOf(uri) });
  return { status: res.status, body: await res.text() };
}
