/**
 * Google Form logging: submit a row per sign-up, and discover a form's entry IDs
 * from its public page so nobody has to dig them out of a pre-filled link.
 */
export const FORM_KEYS = ["name", "email", "provider", "role", "org", "event", "time"] as const;
export type FormKey = (typeof FORM_KEYS)[number];
export const ENV_OF: Record<FormKey, string> = {
  name: "GFORM_ENTRY_NAME",
  email: "GFORM_ENTRY_EMAIL",
  provider: "GFORM_ENTRY_PROVIDER",
  role: "GFORM_ENTRY_ROLE",
  org: "GFORM_ENTRY_ORG",
  event: "GFORM_ENTRY_EVENT",
  time: "GFORM_ENTRY_TIME",
};

export function formConfig() {
  const e = process.env;
  return {
    id: e.GFORM_ID?.trim() || undefined,
    entries: Object.fromEntries(FORM_KEYS.map((k) => [k, e[ENV_OF[k]]?.trim().replace(/^entry\./, "") || undefined])) as Record<FormKey, string | undefined>,
  };
}
export const formReady = () => {
  const f = formConfig();
  return !!(f.id && f.entries.name);
};

export interface FormRow {
  name: string;
  email?: string;
  provider: string;
  role?: string;
  org?: string;
  event: string;
}

/** POST one response. Resolves to null on success, or a sentence saying what went wrong. */
export async function submitForm(row: FormRow): Promise<string | null> {
  const f = formConfig();
  if (!f.id || !f.entries.name) return "Google Form logging is off (GFORM_ID / GFORM_ENTRY_NAME not set)";
  const values: Record<FormKey, string> = { name: row.name, email: row.email ?? "", provider: row.provider, role: row.role ?? "", org: row.org ?? "", event: row.event, time: new Date().toISOString() };
  const body = new URLSearchParams();
  for (const k of FORM_KEYS) if (f.entries[k]) body.append(`entry.${f.entries[k]}`, values[k]);
  try {
    const r = await fetch(`https://docs.google.com/forms/d/e/${f.id}/formResponse`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual",
    });
    const loc = r.headers.get("location") ?? "";
    if (r.status >= 300 && r.status < 400 && /accounts\.google\.com|ServiceLogin/.test(loc)) return "the form only accepts signed-in Google users — turn off 'Restrict to users in …' and 'Collect email addresses' in the form's settings";
    if (r.status === 404) return "form not found — GFORM_ID must be the ID from the form's share link (…/forms/d/e/<ID>/viewform)";
    if (r.status >= 400) return `Google Form answered HTTP ${r.status} — usually a required question that the app doesn't fill, or a wrong entry ID`;
    return null;
  } catch (e) {
    return `could not reach Google Forms: ${(e as Error).message}`;
  }
}

/** Fire-and-forget wrapper used by the server. */
export async function recordToForm(row: FormRow) {
  const err = await submitForm(row);
  if (err && formReady()) console.warn(`[thosaphol-connect] Google Form: ${err}`);
  return !err;
}

export interface FormQuestion {
  title: string;
  entry: string;
  required: boolean;
}

/** Read the questions out of a form's public page (the FB_PUBLIC_LOAD_DATA_ blob). */
export function parseFormPage(html: string): { title: string; questions: FormQuestion[] } | null {
  const m = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const root = data as unknown[];
  const info = root?.[1] as unknown[] | undefined;
  const items = (info?.[1] as unknown[] | undefined) ?? [];
  const questions: FormQuestion[] = [];
  for (const it of items) {
    const item = it as unknown[];
    const answers = item?.[4] as unknown[] | null;
    if (!Array.isArray(answers) || answers.length !== 1) continue; // section headers, images, grids
    const a = answers[0] as unknown[];
    if (typeof a?.[0] !== "number") continue;
    questions.push({ title: String(item[1] ?? "").trim(), entry: String(a[0]), required: !!a[2] });
  }
  return { title: String(root?.[3] ?? info?.[8] ?? ""), questions };
}

const MATCHERS: [FormKey, RegExp][] = [
  ["email", /e-?mail|อีเมล/i],
  ["provider", /provider|login|sign.?in|ช่องทาง|ผู้ให้บริการ|ล็อกอิน|เข้าสู่ระบบ/i],
  ["role", /role|position|occupation|บทบาท|อาชีพ|ตำแหน่ง/i],
  ["org", /org|company|school|university|องค์กร|บริษัท|โรงเรียน|มหาวิทยาลัย|หน่วยงาน|สังกัด/i],
  ["event", /event|action|type|เหตุการณ์|ประเภท/i],
  ["time", /time|date|เวลา|วันที่/i],
  ["name", /name|ชื่อ/i],
];

/** Match questions to the app's fields by title; fall back to question order when titles say nothing. */
export function mapQuestions(qs: FormQuestion[]) {
  const map: Partial<Record<FormKey, FormQuestion>> = {};
  const left: FormQuestion[] = [];
  for (const q of qs) {
    const key = MATCHERS.find(([k, re]) => !map[k] && re.test(q.title))?.[0];
    if (key) map[key] = q;
    else left.push(q);
  }
  if (!Object.keys(map).length) {
    qs.slice(0, FORM_KEYS.length).forEach((q, i) => (map[FORM_KEYS[i]] = q));
    return { map, left: qs.slice(FORM_KEYS.length), byOrder: true };
  }
  return { map, left, byOrder: false };
}
