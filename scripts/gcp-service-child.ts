/** Provider integration helper only. One short-lived token arrives through an anonymous pipe, never argv/env/disk. */
import { OAuth2Client } from "google-auth-library";
import { startService } from "../service/index.js";
let token = "";
for await (const chunk of process.stdin) {
  token += String(chunk);
  if (token.length > 16_000) throw new Error("Invalid test auth input");
}
if (!token.trim()) throw new Error("Missing short-lived test credential");
const authClient = new OAuth2Client();
authClient.setCredentials({
  access_token: token.trim(),
  expiry_date: Date.now() + 45 * 60 * 1000,
});
token = "";
startService(authClient);
