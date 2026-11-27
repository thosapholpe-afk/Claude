import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { installRipples, installTilt } from "./lib/fx";
import { useStudio } from "./store";
import { Editor } from "./ui/App";
import { Landing, Onboarding, startLocal, useAuth } from "./ui/Auth";
import { loadCustomBoards } from "./ui/Modals";
import "./styles.css";

loadCustomBoards();
installRipples();
installTilt();

function Root() {
  const { me, user } = useAuth();
  const theme = useStudio((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  if (me === undefined) return <div className="boot" aria-busy="true" />;
  if (!user) return <Landing me={me} onLocal={startLocal} />;
  return (
    <>
      <Editor />
      {user.needsProfile && <Onboarding user={user} onDone={(u) => useStudio.setState({ user: u })} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
