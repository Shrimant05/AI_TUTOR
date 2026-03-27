"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { LogIn, Eye, EyeOff, Sparkles } from "lucide-react";
import {
  loadAuthSession,
  saveAuthSession,
  syncAuthSessionWithServer,
  clearAuthSession,
} from "../../lib/authStorage";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

// ─── Injected styles (matches main page theme) ─────────────────────────────
const PAGE_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=DM+Mono:wght@300;400;500&display=swap');

  :root {
    --bg:          #05080f;
    --bg2:         #080d18;
    --surface:     rgba(255,255,255,0.032);
    --surface-hi:  rgba(255,255,255,0.06);
    --border:      rgba(255,255,255,0.065);
    --border-hi:   rgba(99,210,255,0.25);
    --accent:      #3dd6f5;
    --accent2:     #7c6ef5;
    --accent-glow: rgba(61,214,245,0.18);
    --text:        #dce8f0;
    --text-2:      #7a8fa0;
    --text-3:      #3d5060;
    --danger:      #f75d6e;
    --danger-sub:  rgba(247,93,110,0.08);
    --radius:      14px;
    --radius-sm:   9px;
    --mono:        'DM Mono', monospace;
    --display:     'Bricolage Grotesque', sans-serif;
    --ease:        cubic-bezier(.22,.68,0,1.2);
  }

  .lg-root * { box-sizing: border-box; margin: 0; padding: 0; }
  .lg-root {
    font-family: var(--display);
    color: var(--text);
    min-height: 100vh;
    background: var(--bg);
  }

  /* ── Ambient background ── */
  .lg-bg {
    position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden;
  }
  .lg-orb {
    position: absolute; border-radius: 50%; filter: blur(90px); opacity: 0.55;
    animation: orbDrift 18s ease-in-out infinite alternate;
  }
  .lg-orb-1 {
    width: 500px; height: 500px; top: -130px; left: -90px;
    background: radial-gradient(circle, rgba(61,214,245,0.2) 0%, transparent 70%);
    animation-delay: 0s;
  }
  .lg-orb-2 {
    width: 420px; height: 420px; bottom: -100px; right: -80px;
    background: radial-gradient(circle, rgba(124,110,245,0.18) 0%, transparent 70%);
    animation-delay: -8s;
  }
  .lg-orb-3 {
    width: 240px; height: 240px; top: 38%; right: 30%;
    background: radial-gradient(circle, rgba(61,214,245,0.07) 0%, transparent 70%);
    animation-delay: -14s;
  }
  @keyframes orbDrift {
    from { transform: translate(0,0) scale(1); }
    to   { transform: translate(28px, 18px) scale(1.07); }
  }

  /* ── Grain ── */
  .lg-grain {
    position: fixed; inset: 0; pointer-events: none; z-index: 1; opacity: 0.025;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 180px 180px;
  }

  /* ── Page layout ── */
  .lg-wrap {
    position: relative; z-index: 2;
    min-height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 48px 24px 64px;
    animation: fadeUp 0.55s var(--ease) both;
  }

  /* ── Logo / hero ── */
  .lg-logo-ring {
    width: 68px; height: 68px; border-radius: 18px;
    background: linear-gradient(135deg, rgba(61,214,245,0.15), rgba(124,110,245,0.12));
    border: 1px solid rgba(61,214,245,0.2);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 20px;
    box-shadow: 0 0 40px rgba(61,214,245,0.1);
  }
  .lg-logo-ring img {
    width: 44px; height: 44px; object-fit: contain;
  }

  .lg-badge {
    display: inline-flex; align-items: center; gap: 6px;
    background: rgba(61,214,245,0.08);
    border: 1px solid rgba(61,214,245,0.2);
    border-radius: 99px;
    padding: 4px 14px;
    font-size: 0.7rem; font-weight: 600;
    color: var(--accent); letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 16px;
  }

  .lg-title {
    font-size: clamp(2rem, 4vw, 2.8rem);
    font-weight: 800; letter-spacing: -0.04em; line-height: 1.1;
    background: linear-gradient(145deg, #e8f4ff 20%, var(--accent) 60%, var(--accent2) 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 8px; text-align: center;
  }

  .lg-sub {
    font-size: 0.95rem; color: var(--text-2); font-weight: 400;
    text-align: center; margin-bottom: 36px;
  }
  .lg-sub span { color: var(--accent); font-weight: 600; }

  /* ── Card ── */
  .lg-card {
    width: 100%; max-width: 420px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 32px 28px;
    backdrop-filter: blur(12px);
    transition: border-color 0.3s;
  }
  .lg-card:focus-within { border-color: rgba(99,210,255,0.18); }

  /* ── Form fields ── */
  .lg-field { display: flex; flex-direction: column; gap: 7px; }
  .lg-field + .lg-field { margin-top: 16px; }

  .lg-label {
    font-size: 0.72rem; font-weight: 700;
    color: var(--text-3); letter-spacing: 0.1em; text-transform: uppercase;
  }

  .lg-input-wrap { position: relative; }

  .lg-input {
    width: 100%;
    background: rgba(255,255,255,0.035);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 11px 16px;
    color: var(--text);
    font-family: var(--display); font-size: 0.93rem;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
    appearance: none;
  }
  .lg-input::placeholder { color: var(--text-3); }
  .lg-input:focus {
    border-color: rgba(61,214,245,0.45);
    box-shadow: 0 0 0 3px rgba(61,214,245,0.08);
    background: rgba(255,255,255,0.05);
  }
  .lg-input.has-icon { padding-right: 42px; }

  /* password eye toggle */
  .lg-eye {
    position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
    background: none; border: none; color: var(--text-3); cursor: pointer;
    display: flex; align-items: center; padding: 2px;
    transition: color 0.18s;
  }
  .lg-eye:hover { color: var(--text-2); }

  /* ── Role pills ── */
  .lg-role-row { display: flex; gap: 8px; }
  .lg-role-pill {
    flex: 1; padding: 10px 8px;
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-2);
    font-family: var(--display);
    font-size: 0.85rem; font-weight: 600;
    cursor: pointer; text-align: center;
    transition: all 0.2s var(--ease);
  }
  .lg-role-pill:hover { border-color: var(--border-hi); color: var(--text); }
  .lg-role-pill.active {
    background: rgba(61,214,245,0.1);
    border-color: rgba(61,214,245,0.4);
    color: var(--accent);
    box-shadow: 0 0 0 3px rgba(61,214,245,0.06);
  }

  /* ── Error ── */
  .lg-error {
    padding: 10px 14px; border-radius: var(--radius-sm);
    background: var(--danger-sub);
    border: 1px solid rgba(247,93,110,0.2);
    color: var(--danger);
    font-size: 0.83rem; line-height: 1.5;
    margin-top: 4px;
  }

  /* ── Submit button ── */
  .lg-submit {
    width: 100%; margin-top: 22px;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    background: linear-gradient(135deg, var(--accent), #5ab8d4);
    border: none; border-radius: var(--radius-sm);
    color: #04121a; font-family: var(--display);
    font-weight: 700; font-size: 0.95rem;
    padding: 13px 20px; cursor: pointer;
    transition: transform 0.15s, box-shadow 0.2s, opacity 0.15s;
  }
  .lg-submit:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 8px 24px rgba(61,214,245,0.3);
  }
  .lg-submit:active:not(:disabled) { transform: translateY(0); }
  .lg-submit:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Spinner ── */
  .lg-spinner {
    width: 16px; height: 16px; border-radius: 50%;
    border: 2px solid rgba(4,18,26,0.25);
    border-top-color: #04121a;
    animation: spin 0.75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Divider ── */
  .lg-divider {
    display: flex; align-items: center; gap: 12px;
    margin: 24px 0 18px;
    font-size: 0.75rem; color: var(--text-3); font-family: var(--mono);
  }
  .lg-divider::before, .lg-divider::after {
    content: ''; flex: 1; height: 1px;
    background: linear-gradient(90deg, transparent, var(--border), transparent);
  }

  /* ── Google ── */
  .lg-google-wrap {
    display: flex; align-items: center; justify-content: center; min-height: 44px;
  }
  .lg-google-note {
    padding: 10px 14px; border-radius: var(--radius-sm);
    background: rgba(255,255,255,0.025);
    border: 1px solid var(--border);
    color: var(--text-3);
    font-size: 0.8rem; text-align: center; line-height: 1.6;
  }

  /* ── Footer link ── */
  .lg-footer {
    margin-top: 24px; text-align: center;
    font-size: 0.87rem; color: var(--text-2);
  }
  .lg-footer a {
    color: var(--accent); font-weight: 700; text-decoration: none;
    transition: opacity 0.18s;
  }
  .lg-footer a:hover { opacity: 0.8; }

  /* ── Loading screen ── */
  .lg-loading {
    display: flex; align-items: center; justify-content: center;
    flex-direction: column; gap: 18px;
    min-height: 100vh; background: var(--bg);
  }
  .lg-loading-ring {
    width: 34px; height: 34px; border-radius: 50%;
    border: 2px solid rgba(61,214,245,0.15);
    border-top-color: var(--accent);
    animation: spin 0.9s linear infinite;
  }
  .lg-loading-text { font-size: 0.82rem; color: var(--text-3); font-family: var(--mono); }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

export default function Login() {
  const [username, setUsername]               = useState("");
  const [password, setPassword]               = useState("");
  const [showPassword, setShowPassword]       = useState(false);
  const [role, setRole]                       = useState("");
  const [error, setError]                     = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [googleReady, setGoogleReady]         = useState(false);
  const [loading, setLoading]                 = useState(false);

  const router        = useRouter();
  const authInputsRef = useRef({ username: "", role: "" });

  useEffect(() => {
    authInputsRef.current = { username, role };
  }, [username, role]);

  const finalizeLogin = (authData) => {
    saveAuthSession({
      token: authData.access_token,
      role: authData.role,
      username: authData.username,
    });
    if (authData.role === "faculty") router.push("/dashboard");
    else router.push("/student");
  };

  const handleGoogleCredential = async (credential) => {
    const selectedName = (authInputsRef.current.username || "").trim();
    const selectedRole = (authInputsRef.current.role || "").trim().toLowerCase();
    try {
      const res = await axios.post("/api/auth/google", {
        id_token: credential,
        role: ["student", "faculty"].includes(selectedRole) ? selectedRole : undefined,
        username: selectedName || undefined,
      });
      finalizeLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Google sign-in failed");
    }
  };

  useEffect(() => {
    const redirectIfAuthenticated = async () => {
      if (sessionStorage.getItem("logout_in_progress") === "1") {
        sessionStorage.removeItem("logout_in_progress");
        clearAuthSession();
        setCheckingSession(false);
        return;
      }

      const session = loadAuthSession();
      if (!session.token) { setCheckingSession(false); return; }
      const synced = await syncAuthSessionWithServer(session.token);
      if (!synced) { clearAuthSession(); setCheckingSession(false); return; }
      const active = synced || session;
      if ((active.role || "").toLowerCase() === "faculty") { router.push("/dashboard"); return; }
      if ((active.role || "").toLowerCase() === "student")  { router.push("/student"); return; }
      setCheckingSession(false);
    };
    redirectIfAuthenticated();
  }, [router]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const scriptId = "google-identity-service";
    let script = document.getElementById(scriptId);
    const renderGoogleButton = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          if (response?.credential) handleGoogleCredential(response.credential);
        },
      });
      const container = document.getElementById("google-login-btn");
      if (container) {
        container.innerHTML = "";
        window.google.accounts.id.renderButton(container, {
          theme: "outline", size: "large", width: "360", text: "signin_with",
        });
        setGoogleReady(true);
      }
    };
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true; script.defer = true;
      script.onload = renderGoogleButton;
      document.body.appendChild(script);
    } else {
      renderGoogleButton();
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    const normalizedUsername = username.trim();
    if (!normalizedUsername) { setError("Username is required"); return; }
    if (!["student", "faculty"].includes((role || "").toLowerCase())) {
      setError("Please select your role");
      return;
    }
    try {
      setLoading(true);
      const form = new URLSearchParams();
      form.append("username", normalizedUsername);
      form.append("password", password);
      const res = await axios.post("/api/auth/token", form, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if ((res.data.role || "").toLowerCase() !== role.toLowerCase()) {
        setError(`This account is registered as ${res.data.role}. Please choose the correct role.`);
        return;
      }
      finalizeLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) return (
    <>
      <style>{PAGE_STYLES}</style>
      <div className="lg-root">
        <div className="lg-loading">
          <div className="lg-loading-ring"/>
          <p className="lg-loading-text">checking session…</p>
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{PAGE_STYLES}</style>
      <div className="lg-root">
        {/* Ambient bg */}
        <div className="lg-bg">
          <div className="lg-orb lg-orb-1"/>
          <div className="lg-orb lg-orb-2"/>
          <div className="lg-orb lg-orb-3"/>
        </div>
        <div className="lg-grain"/>

        <div className="lg-wrap">

          {/* Hero */}
          <div className="lg-logo-ring">
            <img src="/logo.jpeg" alt="EDUXA"/>
          </div>
          <div className="lg-badge"><Sparkles size={11}/> AI-Powered Learning</div>
          <h1 className="lg-title">EDUXA</h1>
          <p className="lg-sub">Empowering Students to <span>Think</span>, Not Just Retrieve</p>

          {/* Card */}
          <div className="lg-card">
            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column" }}>

              {/* Username */}
              <div className="lg-field">
                <label className="lg-label">Username</label>
                <input
                  className="lg-input"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="your_username"
                  required
                />
              </div>

              {/* Role pills — moved above password for better UX flow */}
              <div className="lg-field">
                <label className="lg-label">I am a…</label>
                <div className="lg-role-row">
                  <button
                    type="button"
                    className={`lg-role-pill ${role === "student" ? "active" : ""}`}
                    onClick={() => setRole("student")}
                  >
                    Student
                  </button>
                  <button
                    type="button"
                    className={`lg-role-pill ${role === "faculty" ? "active" : ""}`}
                    onClick={() => setRole("faculty")}
                  >
                    Faculty
                  </button>
                </div>
              </div>

              {/* Password */}
              <div className="lg-field">
                <label className="lg-label">Password</label>
                <div className="lg-input-wrap">
                  <input
                    className="lg-input has-icon"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    className="lg-eye"
                    onClick={() => setShowPassword(v => !v)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={15}/> : <Eye size={15}/>}
                  </button>
                </div>
              </div>

              {error && <div className="lg-error" style={{ marginTop: 16 }}>{error}</div>}

              <button type="submit" className="lg-submit" disabled={loading}>
                {loading ? (
                  <><div className="lg-spinner"/> Signing in…</>
                ) : (
                  <><LogIn size={15}/> Sign In</>
                )}
              </button>
            </form>

            {/* Google */}
            {GOOGLE_CLIENT_ID && (
              <>
                <div className="lg-divider">or continue with</div>
                <div className="lg-google-wrap">
                  <div id="google-login-btn"/>
                  {!googleReady && (
                    <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-3)", fontFamily: "var(--mono)" }}>
                      Loading Google…
                    </p>
                  )}
                </div>
              </>
            )}

            {!GOOGLE_CLIENT_ID && (
              <>
                <div className="lg-divider">or</div>
                <div className="lg-google-note">
                  Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-in.
                </div>
              </>
            )}

            {/* Footer */}
            <p className="lg-footer">
              No account yet?{" "}
              <a href="/register">Register</a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}