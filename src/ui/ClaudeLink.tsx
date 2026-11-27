/** "Claude link" — connect an external Claude (claude.ai connector / Claude Code) to this tab over MCP. */
import { Check, CircleAlert, Copy, KeyRound, Link2, Loader2, Power } from "lucide-react";
import { useEffect, useState } from "react";
import { connectorUrl, regenerateKey, setLinkOn } from "../lib/claudeLink";
import { useStudio } from "../store";
import { Modal } from "./Modals";

const STATUS: Record<string, string> = {
  off: "Off",
  connecting: "Connecting…",
  online: "Linked — Claude can work in this tab",
  elsewhere: "Another tab took over this link",
  error: "Can't reach the server — the link needs the hosted app (not the offline preview)",
};

function CopyField({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="cl-copy">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button
        className="btn sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
          } catch {
            /* the field is selectable as a fallback */
          }
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function ClaudeLinkModal() {
  const link = useStudio((s) => s.link);
  const set = useStudio((s) => s.set);
  const [url, setUrl] = useState(connectorUrl());
  const [confirmNew, setConfirmNew] = useState(false);
  return (
    <Modal title="Claude link" onClose={() => set("modal", null)}>
      <p className="cl-lead">Let Claude work in this tab: it draws circuits, wires PLC panels, writes ladder and code, presses the buttons and checks the result while you watch.</p>

      <div className={`cl-switch ${link.on ? "on" : ""}`}>
        <span className={`cl-dot s-${link.status}`} />
        <span className="cl-state">
          <strong>{link.on ? "On" : "Off"}</strong>
          <small>{STATUS[link.status]}</small>
        </span>
        {link.status === "elsewhere" ? (
          <button className="btn sm" onClick={() => setLinkOn(true)}>
            Use this tab
          </button>
        ) : (
          <button className={`btn sm ${link.on ? "" : "primary"}`} onClick={() => setLinkOn(!link.on)}>
            <Power size={13} /> {link.on ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>

      <h3 className="cl-h">Connector URL</h3>
      <CopyField value={url} label="Connector URL" />
      <p className="cl-note">
        <KeyRound size={12} /> Private: anyone with this URL can edit the circuit in this tab while the link is on.
      </p>

      <h3 className="cl-h">Add it to Claude</h3>
      <ol className="cl-steps">
        <li>
          <b>claude.ai / Claude app:</b> Settings → Connectors → <i>Add custom connector</i>. Name it <code>Thosaphol Connect</code>, paste the URL, Add.
        </li>
        <li>In a chat, switch the connector on from the tools menu and ask, e.g. “วาดวงจร start-stop มอเตอร์ด้วย PLC ใน Thosaphol Connect”.</li>
        <li>
          <b>Claude Code:</b>
          <CopyField value={`claude mcp add --transport http thosaphol ${url}`} label="Claude Code command" />
        </li>
      </ol>
      <p className="cl-note">Keep this tab visible (side by side with Claude) — browsers pause background tabs. On a phone, use the link from a computer or an iPad in Split View.</p>

      {link.log.length > 0 && (
        <>
          <h3 className="cl-h">Activity</h3>
          <ul className="cl-log">
            {[...link.log]
              .reverse()
              .slice(0, 14)
              .map((e) => (
                <li key={e.t + e.tool} className={e.ok ? "" : "bad"}>
                  <time>{new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                  {e.ok ? <Check size={12} /> : <CircleAlert size={12} />}
                  <span>{e.summary}</span>
                </li>
              ))}
          </ul>
        </>
      )}

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        {confirmNew ? (
          <>
            <small className="muted">The old URL stops working.</small>
            <button
              className="btn sm danger"
              onClick={() => {
                regenerateKey();
                setUrl(connectorUrl());
                setConfirmNew(false);
              }}
            >
              Make new URL
            </button>
            <button className="btn sm ghost" onClick={() => setConfirmNew(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn sm ghost" onClick={() => setConfirmNew(true)}>
            <KeyRound size={13} /> New URL
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Top-bar indicator while the link is on: what Claude is doing right now. */
export function ClaudePill({ compact }: { compact?: boolean }) {
  const link = useStudio((s) => s.link);
  const [, tick] = useState(0);
  const fresh = link.last && Date.now() - link.last.t < 5000;
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => tick((n) => n + 1), 5000 - (Date.now() - link.last!.t));
    return () => clearTimeout(t);
  }, [fresh, link.last]);
  if (!link.on) return null;
  const text = link.busy ? link.busy.replace(/_/g, " ") : fresh ? link.last!.summary : link.status === "online" ? "Claude" : STATUS[link.status].split(" —")[0];
  return (
    <button className={`btn ghost claude-pill s-${link.status} ${link.busy ? "busy" : ""}`} onClick={() => useStudio.setState({ modal: "claude" })} title={`Claude link: ${STATUS[link.status]}`}>
      {link.busy ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />}
      {!compact && <span>{text}</span>}
      <i className="cl-dot" />
    </button>
  );
}
