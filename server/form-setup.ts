/**
 * npm run form:setup -- <form link>   print the GFORM_* lines for .env / the host's settings
 * npm run form:test                   send one test row with the current settings
 */
import "dotenv/config";
import { ENV_OF, FORM_KEYS, mapQuestions, parseFormPage, submitForm } from "./form";

const [cmd, arg] = process.argv.slice(2);

async function setup(link: string | undefined) {
  if (!link) {
    console.log("Usage: npm run form:setup -- https://docs.google.com/forms/d/e/<ID>/viewform   (or a forms.gle link)");
    process.exit(1);
  }
  if (/\/forms\/d\/(?!e\/)[^/]+\/edit/.test(link)) {
    console.log("That is the editor link. In the form press Send → link icon, copy that link, and run this again with it.");
    process.exit(1);
  }
  const r = await fetch(link, { redirect: "follow" });
  const id = r.url.match(/\/forms\/d\/e\/([^/]+)\//)?.[1];
  if (!r.ok || !id) {
    console.log(`Couldn't open the form (HTTP ${r.status}). Check the link, and that the form isn't restricted to signed-in users.`);
    process.exit(1);
  }
  const page = parseFormPage(await r.text());
  if (!page || !page.questions.length) {
    console.log("Opened the form but found no questions. Add short-answer questions (Name, Email, Provider, Role, Organization, Event, Time) and try again.");
    process.exit(1);
  }
  const { map, left, byOrder } = mapQuestions(page.questions);
  console.log(`\nForm: ${page.title || "(untitled)"} — ${page.questions.length} questions${byOrder ? " (matched by order: name, email, provider, role, organization, event, time)" : ""}\n`);
  console.log("# ---- copy these into .env (or your host's environment settings) ----");
  console.log(`GFORM_ID=${id}`);
  for (const k of FORM_KEYS) console.log(`${ENV_OF[k]}=${map[k]?.entry ?? ""}`);
  console.log("# --------------------------------------------------------------------\n");
  for (const k of FORM_KEYS) console.log(`  ${k.padEnd(9)} ← ${map[k] ? `"${map[k]!.title}"` : "(no matching question — that field just isn't recorded)"}`);
  console.log("");
  if (!map.name) console.log("! No question looks like the person's name — that one is required. Add a 'Name' question.");
  for (const q of left) console.log(`! Question not used by the app: "${q.title}"${q.required ? " — it is REQUIRED, so every submission will fail. Make it optional or delete it." : ""}`);
  const blankable = (["email", "role", "org"] as const).map((k) => map[k]).filter((q) => q?.required);
  if (blankable.length) console.log(`! ${blankable.map((q) => `"${q!.title}"`).join(", ")} ${blankable.length > 1 ? "are" : "is"} required, but some sign-ins have no email and role/organization are optional in the app — make ${blankable.length > 1 ? "them" : "it"} optional or those rows will be rejected.`);
  console.log("Then check it with:  npm run form:test");
}

async function test() {
  const err = await submitForm({ name: "Test row from Thosaphol Connect", email: "test@example.com", provider: "test", role: "test", org: "test", event: "test" });
  if (err) {
    console.log(`✗ ${err}`);
    process.exit(1);
  }
  console.log("✓ Sent. Open the form's Responses tab (or its linked Sheet) — a row named 'Test row from Thosaphol Connect' should be there.");
}

if (cmd === "setup") await setup(arg);
else if (cmd === "test") await test();
else console.log("Use: npm run form:setup -- <form link>   |   npm run form:test");
