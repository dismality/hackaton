import { createSign } from "node:crypto";
import { env, integrations } from "@/lib/env";

let cachedToken: { token: string; expiresAt: number } | null = null;

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const { clientEmail, privateKey } = env.sheets;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(privateKey!);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google auth failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.token;
}

async function sheetsFetch(path: string, init: RequestInit) {
  const token = await accessToken();
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.sheets.spreadsheetId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}

/** Overwrites the roster tab with `rows`, creating the tab if it doesn't exist. Returns the sheet URL. */
export async function publishRosterToSheet(rows: (string | number)[][]): Promise<string | null> {
  if (!integrations.sheets) return null;
  const tab = env.sheets.tab;
  const range = encodeURIComponent(`${tab}!A1`);
  const write = () =>
    sheetsFetch(`/values/${range}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: rows }) });

  let res = await write();
  if (res.status === 400) {
    await sheetsFetch(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    });
    res = await write();
  }
  if (!res.ok) throw new Error(`Sheets write failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  await sheetsFetch(`/values/${encodeURIComponent(`${tab}!A${rows.length + 1}:Z500`)}:clear`, { method: "POST" });
  return `https://docs.google.com/spreadsheets/d/${env.sheets.spreadsheetId}`;
}
