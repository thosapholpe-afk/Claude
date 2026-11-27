import { Bot, CheckCircle2, CircleX, Send, Sparkles, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { agentAvailable, resetAgent, runLocalAgent, runRemoteAgent, SUGGESTIONS, type ChatAction, type ChatMsg } from "../lib/ai";
import { useStudio } from "../store";

export function AIChat() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState<boolean | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const user = useStudio((s) => s.user);
  const toast = useStudio((s) => s.toast);
  const prefersThai = typeof navigator !== "undefined" && navigator.language.startsWith("th");

  useEffect(() => {
    void agentAvailable().then(setRemote);
  }, []);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);
  useEffect(() => {
    const onAsk = (e: Event) => void send((e as CustomEvent<string>).detail);
    window.addEventListener("xtwin:ask", onAsk);
    return () => window.removeEventListener("xtwin:ask", onAsk);
  });

  const send = async (raw?: string) => {
    const q = (raw ?? text).trim();
    if (!q || busy) return;
    setText("");
    setBusy(true);
    const actions: ChatAction[] = [];
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "", pending: true, actions }]);
    const onAction = (a: ChatAction) => {
      actions.push(a);
      setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, actions: [...actions] } : x)));
    };
    let reply = "";
    try {
      reply = remote ? await runRemoteAgent(q, onAction) : await runLocalAgent(q, onAction);
    } catch (e) {
      const msg = (e as Error).message;
      toast(`AI: ${msg} — switching to the offline assistant`, "warn");
      setRemote(false);
      reply = await runLocalAgent(q, onAction);
    }
    setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, text: reply || (actions.length ? "Done." : "…"), pending: false, actions: [...actions] } : x)));
    setBusy(false);
  };

  return (
    <div className="panel ai-panel">
      <div className="panel-head">
        <h2>
          <Sparkles size={16} /> Copilot
        </h2>
        <span className={`status-dot ${remote ? "on" : ""}`} title={remote ? "Connected to Claude" : "Offline assistant (keyword commands)"}>
          {remote === null ? "…" : remote ? "Claude" : "Offline"}
        </span>
        <button
          className="btn icon sm"
          aria-label="New conversation"
          onClick={() => {
            resetAgent();
            setMsgs([]);
          }}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="chat" ref={listRef}>
        {!msgs.length && (
          <div className="chat-empty">
            <Bot size={28} />
            <p>
              {prefersThai ? "สั่งได้เลย เช่น ให้สร้างวงจร ต่อสาย เขียนโค้ด เอาบอร์ดไปจำลองในสถานการณ์ต่าง ๆ หรือออกแบบเคส" : `Hi${user ? ` ${user.name.split(" ")[0]}` : ""}. Ask me to build a circuit, wire pins, write firmware, drop the board into a scenario, or design its case.`}
            </p>
            <div className="suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s.en} className="chip" onClick={() => void send(prefersThai ? s.th : s.en)}>
                  {prefersThai ? s.th : s.en}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.actions && m.actions.length > 0 && (
              <ul className="actions">
                {m.actions.map((a, k) => (
                  <li key={k} className={a.ok ? "ok" : "bad"}>
                    {a.ok ? <CheckCircle2 size={13} /> : <CircleX size={13} />}
                    <span>{a.summary}</span>
                  </li>
                ))}
              </ul>
            )}
            {m.pending ? (
              <p className="typing" aria-label="Thinking">
                <i />
                <i />
                <i />
              </p>
            ) : (
              m.text && <p>{m.text}</p>
            )}
          </div>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={prefersThai ? "พิมพ์สิ่งที่อยากให้ทำ…" : "Tell the copilot what to do…"}
          aria-label="Message the copilot"
        />
        <button className="btn primary icon" disabled={busy || !text.trim()} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
