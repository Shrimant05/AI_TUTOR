"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import {
  loadAuthSession,
  saveAuthSession,
  syncAuthSessionWithServer,
  clearAuthSession,
} from "../../lib/authStorage";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

export default function Register() {
  const [username, setUsername]               = useState("");
  const [password, setPassword]               = useState("");
  const [role, setRole]                       = useState("");
  const [error, setError]                     = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [googleReady, setGoogleReady]         = useState(false);
  const [loading, setLoading]                 = useState(false);

  const router        = useRouter();
  const authInputsRef = useRef({ username: "", role: "" });
  const wrapperRef    = useRef(null);
  const cardRef       = useRef(null);
  const logoRef       = useRef(null);

  useEffect(() => {
    authInputsRef.current = { username, role };
  }, [username, role]);

  // ── Page entry GSAP ──
  useEffect(() => {
    let ctx;
    const run = async () => {
      const { default: gsap } = await import("gsap");
      ctx = gsap.context(() => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

        tl.from(".auth-orb", {
          scale: 0.4, opacity: 0, duration: 1.4, stagger: 0.25, ease: "power2.out",
        }, 0)
        .from(logoRef.current, {
          y: -30, opacity: 0, duration: 0.7,
        }, 0.2)
        .from([".auth-title", ".auth-subtitle"], {
          y: 24, opacity: 0, duration: 0.6, stagger: 0.1,
        }, 0.4)
        .from(cardRef.current, {
          y: 36, opacity: 0, duration: 0.65,
        }, 0.5)
        .from(".form-field", {
          y: 18, opacity: 0, duration: 0.45, stagger: 0.08,
        }, 0.7)
        .from([".auth-submit", ".reg-google-section"], {
          y: 12, opacity: 0, duration: 0.4, stagger: 0.1,
        }, 0.9)
        .from(".auth-footer", {
          opacity: 0, duration: 0.4,
        }, 1.1);
      }, wrapperRef.current);
    };
    run();
    return () => ctx?.revert();
  }, []);

  const finalizeLogin = (authData) => {
    saveAuthSession({
      token: authData.access_token,
      role: authData.role,
      username: authData.username,
    });
    if (authData.role === "faculty") router.push("/dashboard");
    else router.push("/");
  };

  const handleGoogleCredential = async (credential) => {
    const selectedName = (authInputsRef.current.username || "").trim();
    const selectedRole = (authInputsRef.current.role || "").trim().toLowerCase();
    if (!selectedName) { setError("Enter your name and select role before Google sign-up."); return; }
    if (!["student", "faculty"].includes(selectedRole)) { setError("Select role before Google sign-up."); return; }
    try {
      const res = await axios.post("http://localhost:8000/api/auth/google", {
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
      const session = loadAuthSession();
      if (!session.token) { setCheckingSession(false); return; }
      const synced = await syncAuthSessionWithServer(session.token);
      if (!synced) { clearAuthSession(); setCheckingSession(false); return; }
      const active = synced || session;
      if ((active.role || "").toLowerCase() === "faculty") { router.push("/dashboard"); return; }
      if ((active.role || "").toLowerCase() === "student")  { router.push("/"); return; }
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
          theme: "outline", size: "large", width: "320", text: "signup_with",
        });
        setGoogleReady(true);
      }
    };
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
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
      await axios.post("http://localhost:8000/api/auth/register", {
        username: normalizedUsername, password, role: normalizedRole,
      });
      const res = await axios.post("http://localhost:8000/api/auth/login", {
        username: normalizedUsername, password,
      });
      finalizeLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="loading-screen">
        <div className="loading-ring" />
        <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Checking session…</span>
      </div>
    );
  }

  const canUseGoogle =
    username.trim().length > 0 &&
    ["student", "faculty"].includes((role || "").toLowerCase());

  return (
    <div ref={wrapperRef} className="auth-wrapper">

      {/* ── Ambient orbs ── */}
      <div className="auth-orb" style={{
        position: "fixed", top: "10%", right: "10%",
        width: 360, height: 360,
        background: "radial-gradient(circle, rgba(139,92,246,0.13) 0%, transparent 70%)",
        borderRadius: "50%", pointerEvents: "none", zIndex: 0,
      }} />
      <div className="auth-orb" style={{
        position: "fixed", bottom: "12%", left: "7%",
        width: 300, height: 300,
        background: "radial-gradient(circle, rgba(0,229,160,0.09) 0%, transparent 70%)",
        borderRadius: "50%", pointerEvents: "none", zIndex: 0,
      }} />

      {/* ── Logo mark ── */}
      <div ref={logoRef} style={{ marginBottom: 16, zIndex: 1 }}>
        <div style={{
          width: 48, height: 48,
          background: "linear-gradient(135deg, #8b5cf6 0%, #4f7cff 100%)",
          borderRadius: 14,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "1.5rem",
          boxShadow: "0 8px 32px rgba(139,92,246,0.35)",
        }}>
          ✦
        </div>
      </div>

      <h1 className="auth-title">Create account</h1>
      <p className="auth-subtitle">Join ContextAI today</p>

      <div ref={cardRef} className="glass-panel auth-card" style={{ padding: "32px 28px", zIndex: 1 }}>
        <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: 18 }}>

          <div className="form-field">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="choose_a_username"
              required
            />
          </div>

          <div className="form-field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <div className="form-field">
            <label>I am a…</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={{ cursor: "pointer" }}>
              <option value="" disabled>Select role…</option>
              <option value="student">Student</option>
              <option value="faculty">Faculty Member</option>
            </select>
          </div>

          {error && (
            <p style={{
              color: "var(--danger)",
              fontSize: "0.85rem",
              padding: "10px 12px",
              background: "var(--danger-subtle)",
              borderRadius: 8,
              border: "1px solid rgba(255,79,107,0.2)",
              margin: 0,
            }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            className="auth-submit send-btn"
            disabled={loading}
            style={{ width: "100%", padding: "13px", justifyContent: "center", fontSize: "0.95rem", borderRadius: 10 }}
          >
            {loading ? (
              <>
                <span style={{
                  width: 16, height: 16,
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spinRing 0.7s linear infinite",
                }} />
                Creating account…
              </>
            ) : "Register"}
          </button>
        </form>

        {/* ── Google section ── */}
        <div className="reg-google-section" style={{ marginTop: 20 }}>
          <div className="divider" style={{ marginBottom: 14 }}>or sign up with Google</div>

          {!canUseGoogle && GOOGLE_CLIENT_ID && (
            <p style={{
              textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem",
              padding: "10px 14px",
              background: "rgba(255,255,255,0.025)",
              borderRadius: 8, border: "1px solid var(--panel-border)",
            }}>
              Fill in username &amp; role above to enable Google sign-up
            </p>
          )}

          {canUseGoogle && GOOGLE_CLIENT_ID && (
            <div style={{ display: "flex", justifyContent: "center", minHeight: 42 }}>
              <div id="google-register-btn" />
              {!googleReady && (
                <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.82rem" }}>Loading…</p>
              )}
            </div>
          )}

          {!GOOGLE_CLIENT_ID && (
            <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem", margin: 0 }}>
              Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-up.
            </p>
          )}
        </div>

        {/* ── Footer ── */}
        <p className="auth-footer" style={{
          marginTop: 24, textAlign: "center",
          fontSize: "0.88rem", color: "var(--text-secondary)",
        }}>
          Already have an account?{" "}
          <a href="/login" style={{ color: "var(--accent-color)", textDecoration: "none", fontWeight: 600 }}>
            Sign In
          </a>
        </p>
      </div>
    </div>
  );
}