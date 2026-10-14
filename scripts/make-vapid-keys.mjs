#!/usr/bin/env node
// Prints a new VAPID key pair for the office's web push (RFC 8292): the public and
// the private key, base64url, as `web-push generate-vapid-keys` prints them.
// Nothing is stored or sent. Sahan runs it himself and sets the Edge Function
// secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (mailto:<office
// address>) with `npx supabase secrets set`. A new pair makes every browser's
// subscription invalid: people turn notifications on again.
//   source ~/.nvm/nvm.sh && nvm use >/dev/null && node scripts/make-vapid-keys.mjs
import { webcrypto } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = b64url(await webcrypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log("VAPID_SUBJECT=mailto:<an office address>");
