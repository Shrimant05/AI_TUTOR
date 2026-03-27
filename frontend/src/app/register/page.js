"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { UserPlus, Eye, EyeOff, Sparkles } from "lucide-react";
import {
  loadAuthSession,
  saveAuthSession,
  syncAuthSessionWithServer,
  clearAuthSession,
} from "../../lib/authStorage";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

// ─── Injected styles (matches main page theme) ────────────────────────────
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

  .rg-root * { box-sizing: border-box; margin: 0; padding: 0; }
  .rg-root {
    font-family: var(--display);
    color: var(--text);
    min-height: 100vh;
    background: var(--bg);
  }

  /* ── Ambient background ── */
  .rg-bg {
    position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden;
  }
  .rg-orb {
    position: absolute; border-radius: 50%; filter: blur(90px); opacity: 0.55;
    animation: orbDrift 18s ease-in-out infinite alternate;
  }
  .rg-orb-1 {
    width: 480px; height: 480px; top: -120px; right: -80px;
    background: radial-gradient(circle, rgba(124,110,245,0.22) 0%, transparent 70%);
    animation-delay: 0s;
  }
  .rg-orb-2 {
    width: 400px; height: 400px; bottom: -100px; left: -80px;
    background: radial-gradient(circle, rgba(61,214,245,0.16) 0%, transparent 70%);
    animation-delay: -7s;
  }
  .rg-orb-3 {
    width: 260px; height: 260px; top: 50%; left: 40%;
    background: radial-gradient(circle, rgba(124,110,245,0.07) 0%, transparent 70%);
    animation-delay: -13s;
  }
  @keyframes orbDrift {
    from { transform: translate(0,0) scale(1); }
    to   { transform: translate(28px, 18px) scale(1.07); }
  }

  /* ── Grain ── */
  .rg-grain {
    position: fixed; inset: 0; pointer-events: none; z-index: 1; opacity: 0.025;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 180px 180px;
  }

  /* ── Page layout ── */
  .rg-wrap {
    position: relative; z-index: 2;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px 64px;
    animation: fadeUp 0.55s var(--ease) both;
  }

  /* ── Logo / hero ── */
  .rg-logo-ring {
    width: 68px; height: 68px; border-radius: 18px;
    background: linear-gradient(135deg, rgba(61,214,245,0.15), rgba(124,110,245,0.12));
    border: 1px solid rgba(61,214,245,0.2);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 20px;
    box-shadow: 0 0 40px rgba(61,214,245,0.1);
  }
  .rg-logo-ring img {
    width: 44px; height: 44px; object-fit: contain;
  }

  .rg-badge {
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

  .rg-title {
    font-size: clamp(2rem, 4vw, 2.8rem);
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1.1;
    background: linear-gradient(145deg, #e8f4ff 20%, var(--accent) 60%, var(--accent2) 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 8px;
    text-align: center;
  }

  .rg-sub {
    font-size: 0.95rem; color: var(--text-2); font-weight: 400;
    text-align: center; margin-bottom: 36px;
  }
  .rg-sub span { color: var(--accent); font-weight: 600; }

  /* ── Card ── */
  .rg-card {
    width: 100%; max-width: 420px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 32px 28px;
    backdrop-filter: blur(12px);
    transition: border-color 0.3s;
  }
  .rg-card:focus-within { border-color: rgba(99,210,255,0.18); }

  /* ── Form fields ── */
  .rg-field { display: flex; flex-direction: column; gap: 7px; }
  .rg-field + .rg-field { margin-top: 16px; }

  .rg-label {
    font-size: 0.72rem; font-weight: 700;
    color: var(--text-3); letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .rg-input-wrap { position: relative; }

  .rg-input, .rg-select {
    width: 100%;
    background: rgba(255,255,255,0.035);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 11px 16px;
    color: var(--text);
    font-family: var(--display);
    font-size: 0.93rem;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
    appearance: none;
  }
  .rg-input::placeholder { color: var(--text-3); }
  .rg-input:focus, .rg-select:focus {
    border-color: rgba(61,214,245,0.45);
    box-shadow: 0 0 0 3px rgba(61,214,245,0.08);
    background: rgba(255,255,255,0.05);
  }
  .rg-input.has-icon { padding-right: 42px; }

  /* password eye toggle */
  .rg-eye {
    position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
    background: none; border: none; color: var(--text-3); cursor: pointer;
    display: flex; align-items: center; padding: 2px;
    transition: color 0.18s;
  }
  .rg-eye:hover { color: var(--text-2); }

  /* select arrow */
  .rg-select-wrap { position: relative; }
  .rg-select-wrap::after {
    content: '';
    position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
    width: 0; height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid var(--text-3);
    pointer-events: none;
  }
  .rg-select option {
    background: #0e1624; color: var(--text);
  }

  /* ── Role pills ── */
  .rg-role-row { display: flex; gap: 8px; }
  .rg-role-pill {
    flex: 1; padding: 10px 8px;
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-2);
    font-family: var(--display);
    font-size: 0.85rem; font-weight: 600;
    cursor: pointer;
    text-align: center;
    transition: all 0.2s var(--ease);
  }
  .rg-role-pill:hover { border-color: var(--border-hi); color: var(--text); }
  .rg-role-pill.active {
    background: rgba(61,214,245,0.1);
    border-color: rgba(61,214,245,0.4);
    color: var(--accent);
    box-shadow: 0 0 0 3px rgba(61,214,245,0.06);
  }

  /* ── Error ── */
  .rg-error {
    padding: 10px 14px; border-radius: var(--radius-sm);
    background: var(--danger-sub);
    border: 1px solid rgba(247,93,110,0.2);
    color: var(--danger);
    font-size: 0.83rem; line-height: 1.5;
    margin-top: 4px;
  }

  /* ── Submit button ── */
  .rg-submit {
    width: 100%; margin-top: 22px;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    background: linear-gradient(135deg, var(--accent), #5ab8d4);
    border: none; border-radius: var(--radius-sm);
    color: #04121a; font-family: var(--display);
    font-weight: 700; font-size: 0.95rem;
    padding: 13px 20px; cursor: pointer;
    transition: transform 0.15s, box-shadow 0.2s, opacity 0.15s;
  }
  .rg-submit:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 8px 24px rgba(61,214,245,0.3);
  }
  .rg-submit:active:not(:disabled) { transform: translateY(0); }
  .rg-submit:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Spinner inside button ── */
  .rg-spinner {
    width: 16px; height: 16px; border-radius: 50%;
    border: 2px solid rgba(4,18,26,0.25);
    border-top-color: #04121a;
    animation: spin 0.75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Divider ── */
  .rg-divider {
    display: flex; align-items: center; gap: 12px;
    margin: 24px 0 18px;
    font-size: 0.75rem; color: var(--text-3); font-family: var(--mono);
  }
  .rg-divider::before, .rg-divider::after {
    content: ''; flex: 1; height: 1px;
    background: linear-gradient(90deg, transparent, var(--border), transparent);
  }

  /* ── Google section ── */
  .rg-google-note {
    padding: 10px 14px; border-radius: var(--radius-sm);
    background: rgba(255,255,255,0.025);
    border: 1px solid var(--border);
    color: var(--text-3);
    font-size: 0.8rem; text-align: center; line-height: 1.6;
  }
  .rg-google-wrap {
    display: flex; align-items: center; justify-content: center; min-height: 44px;
  }

  /* ── Footer link ── */
  .rg-footer {
    margin-top: 24px; text-align: center;
    font-size: 0.87rem; color: var(--text-2);
  }
  .rg-footer a {
    color: var(--accent); font-weight: 700; text-decoration: none;
    transition: opacity 0.18s;
  }
  .rg-footer a:hover { opacity: 0.8; }

  /* ── Loading screen ── */
  .rg-loading {
    display: flex; align-items: center; justify-content: center;
    flex-direction: column; gap: 18px;
    min-height: 100vh; background: var(--bg);
  }
  .rg-loading-ring {
    width: 34px; height: 34px; border-radius: 50%;
    border: 2px solid rgba(61,214,245,0.15);
    border-top-color: var(--accent);
    animation: spin 0.9s linear infinite;
  }
  .rg-loading-text { font-size: 0.82rem; color: var(--text-3); font-family: var(--mono); }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

export default function Register() {
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
    if (!selectedName) { setError("Enter your name and select a role before Google sign-up."); return; }
    if (!["student", "faculty"].includes(selectedRole)) { setError("Select a role before Google sign-up."); return; }
    try {
      const res = await axios.post("/api/auth/google", {
        id_token: credential,
        role: selectedRole,
        username: selectedName,
      });
      finalizeLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Google sign-up failed");
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
      const container = document.getElementById("google-register-btn");
      if (container) {
        container.innerHTML = "";
        window.google.accounts.id.renderButton(container, {
          theme: "outline", size: "large", width: "360", text: "signup_with",
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
  }, [role]);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    const normalizedUsername = username.trim();
    const normalizedRole     = role.trim().toLowerCase();
    if (!normalizedUsername) { setError("Username is required"); return; }
    if (!["student", "faculty"].includes(normalizedRole)) { setError("Please select your role"); return; }
    try {
      setLoading(true);
      await axios.post("/api/auth/register", {
        username: normalizedUsername, password, role: normalizedRole,
      });
      const res = await axios.post("/api/auth/login", {
        username: normalizedUsername, password,
      });
      finalizeLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const canUseGoogle =
    username.trim().length > 0 &&
    ["student", "faculty"].includes((role || "").toLowerCase());

  if (checkingSession) return (
    <>
      <style>{PAGE_STYLES}</style>
      <div className="rg-root">
        <div className="rg-loading">
          <div className="rg-loading-ring"/>
          <p className="rg-loading-text">checking session…</p>
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{PAGE_STYLES}</style>
      <div className="rg-root">
        {/* Ambient bg */}
        <div className="rg-bg">
          <div className="rg-orb rg-orb-1"/>
          <div className="rg-orb rg-orb-2"/>
          <div className="rg-orb rg-orb-3"/>
        </div>
        <div className="rg-grain"/>

        <div className="rg-wrap">

          {/* Hero */}
          <div className="rg-logo-ring">
            <img src="/logo.jpeg" alt="EDUXA"/>
          </div>
          <div className="rg-badge"><Sparkles size={11}/> AI-Powered Learning</div>
          <h1 className="rg-title">EDUXA</h1>
          <p className="rg-sub">Create your account to get started</p>

          {/* Card */}
          <div className="rg-card">
            <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column" }}>

              {/* Username */}
              <div className="rg-field">
                <label className="rg-label">Username</label>
                <input
                  className="rg-input"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="choose_a_username"
                  required
                />
              </div>

              {/* Password */}
              <div className="rg-field">
                <label className="rg-label">Password</label>
                <div className="rg-input-wrap">
                  <input
                    className="rg-input has-icon"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    className="rg-eye"
                    onClick={() => setShowPassword(v => !v)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={15}/> : <Eye size={15}/>}
                  </button>
                </div>
              </div>

              {/* Role pills */}
              <div className="rg-field">
                <label className="rg-label">I am a…</label>
                <div className="rg-role-row">
                  <button
                    type="button"
                    className={`rg-role-pill ${role === "student" ? "active" : ""}`}
                    onClick={() => setRole("student")}
                  >
                    Student
                  </button>
                  <button
                    type="button"
                    className={`rg-role-pill ${role === "faculty" ? "active" : ""}`}
                    onClick={() => setRole("faculty")}
                  >
                    Faculty
                  </button>
                </div>
              </div>

              {error && <div className="rg-error" style={{ marginTop: 16 }}>{error}</div>}

              <button type="submit" className="rg-submit" disabled={loading}>
                {loading ? (
                  <><div className="rg-spinner"/> Creating account…</>
                ) : (
                  <><UserPlus size={15}/> Create Account</>
                )}
              </button>
            </form>

            {/* Google */}
            {GOOGLE_CLIENT_ID && (
              <>
                <div className="rg-divider">or sign up with Google</div>
                {!canUseGoogle ? (
                  <div className="rg-google-note">
                    Fill in your username &amp; select a role above to enable Google sign-up
                  </div>
                ) : (
                  <div className="rg-google-wrap">
                    <div id="google-register-btn"/>
                    {!googleReady && (
                      <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-3)", fontFamily: "var(--mono)" }}>
                        Loading…
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {!GOOGLE_CLIENT_ID && (
              <>
                <div className="rg-divider">or</div>
                <div className="rg-google-note">Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-up.</div>
              </>
            )}

            {/* Footer */}
            <p className="rg-footer">
              Already have an account?{" "}
              <a href="/login">Sign In</a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}