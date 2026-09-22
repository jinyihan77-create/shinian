import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const PROJECT = "C:/Users/qiqi/Desktop/我的第一个项目";
const sha256 = (m, s, e) => crypto.createHmac("sha256", s).update(m).digest(e);
const getHash = m => crypto.createHash("sha256").update(m).digest("hex");
const getDate = ts => { const d = new Date(ts * 1000); return `${d.getUTCFullYear()}-${("0"+(d.getUTCMonth()+1)).slice(-2)}-${("0"+d.getUTCDate()).slice(-2)}`; };

export async function loadCredential() {
  const auth = JSON.parse(await readFile(path.join(homedir(), ".config", ".cloudbase", "auth.json"), "utf8"));
  return auth.credential;
}

/** 完全复刻 CLI 的 getRequestSign + requestWithSign */
export async function callApi({ service, action, version, payload, credential, region = "ap-shanghai" }) {
  const url = `https://${service}.tencentcloudapi.com`;
  const host = new URL(url).hostname;
  const bodyStr = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const headers = `content-type:application/json\nhost:${host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = `POST\n/\n\n${headers}\n${signedHeaders}\n${getHash(bodyStr)}`;
  const date = getDate(ts);
  const stringToSign = `TC3-HMAC-SHA256\n${ts}\n${date}/${service}/tc3_request\n${getHash(canonicalRequest)}`;
  const kDate = sha256(date, `TC3${credential.tmpSecretKey}`);
  const kService = sha256(service, kDate);
  const kSigning = sha256("tc3_request", kService);
  const signature = sha256(stringToSign, kSigning, "hex");
  const reqHeaders = {
    Host: host, "Content-Type": "application/json",
    "X-TC-Action": action, "X-TC-Region": region,
    "X-TC-Timestamp": String(ts), "X-TC-Version": version,
    Authorization: `TC3-HMAC-SHA256 Credential=${credential.tmpSecretId}/${date}/${service}/tc3_request, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (credential.tmpToken) reqHeaders["X-TC-Token"] = credential.tmpToken;
  const res = await fetch(url, { method: "POST", headers: reqHeaders, body: bodyStr, signal: AbortSignal.timeout(60000) });
  return await res.json();
}
