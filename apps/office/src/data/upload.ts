// Web build only: a file goes from the browser straight to Storage through the
// one-time signed upload a tool handed out (photo_upload_url,
// vehicle_document_upload_url); no file goes through office-api or chat.
// WebApp passes this in the context (`files`), so the artifact has no Supabase
// code and no upload button.
import { supabase } from "../auth/supabase";
import type { UploadTicket } from "./types";

export async function uploadToTicket(ticket: UploadTicket, file: Blob, contentType: string): Promise<void> {
  if (!supabase) throw { code: "not_configured", message: "This copy of the web app cannot upload files." };
  let error: { message: string } | null;
  try {
    ({ error } = await supabase.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType }));
  } catch {
    throw { code: "upload_failed", message: "No connection: the file did not go up. Try again." };
  }
  if (error) throw { code: "upload_failed", message: `The file did not go up: ${error.message}` };
}
