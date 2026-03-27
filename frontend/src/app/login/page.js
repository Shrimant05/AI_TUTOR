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

export default function Login() {
  const [username, setUsername]             = useState("");
  const [password, setPassword]             = useState("");
  const [role, setRole]                     = useState("");
  const [error, setError]                   = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [googleReady, setGoogleReady]       = useState(false);
  const [loading, setLoading]               = useState(false);

  const router        = useRouter();
  const authInputsRef = useRef({ username: "", role: "" });
  const wrapperRef    = useRef(null);
  const cardRef       = useRef(null);
  const logoRef       = useRef(null);

  useEffect(() => {
    authInputsRef.current = { username, role };
  }, [username, role]);

  // ── Page entry GSAP animation ──
  useEffect(() => {
    let ctx;
    const run = async () => {
      const { default: gsap } = await import("gsap");
      ctx = gsap.context(() => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

        // Ambient orbs
        tl.from(".auth-orb", {
          scale: 0.4,
          opacity: 0,
          duration: 1.4,
          stagger: 0.25,
          ease: "power2.out",
        }, 0)
        // Logo mark
        .from(logoRef.current, {
          y: -30,
          opacity: 0,
          duration: 0.7,
        }, 0.2)
        // Heading + subtitle
        .from([".auth-title", ".auth-subtitle"], {
          y: 24,
          opacity: 0,
          duration: 0.6,
          stagger: 0.1,
        }, 0.4)
        // Card itself
        .from(cardRef.current, {
          y: 36,
          opacity: 0,
          duration: 0.65,
        }, 0.5)
        // Form fields stagger
        .from(".form-field", {
          y: 18,
          opacity: 0,
          duration: 0.45,
          stagger: 0.08,
        }, 0.7)
        // Submit button + divider + google section
        .from([".auth-submit", ".auth-divider", ".auth-google-section"], {
          y: 12,
          opacity: 0,
          duration: 0.4,
          stagger: 0.07,
        }, 0.9)
        .from(".auth-footer", {
          opacity: 0,
          duration: 0.4,
        }, 1.1);
      }, wrapperRef.current);
    };
    run();
    return () => ctx?.revert();
  }, []);

  // ── Auth guards ──
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
    try {
      const res = await axios.post("http://localhost:8000/api/auth/google", {
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
      const container = document.getElementById("google-login-btn");
      if (container) {
        container.innerHTML = "";
        window.google.accounts.id.renderButton(container, {
          theme: "outline", size: "large", width: "320", text: "signin_with",
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
      const res = await axios.post("http://localhost:8000/api/auth/token", form, {
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

  // ── Render: loading state ──
  if (checkingSession) {
    return (
      <div className="loading-screen">
        <div className="loading-ring" />
        <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Checking session…</span>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="auth-wrapper">

      {/* ── Ambient orbs ── */}
      <div className="auth-orb" style={{
        position: "fixed", top: "15%", left: "8%",
        width: 380, height: 380,
        background: "radial-gradient(circle, rgba(79,124,255,0.14) 0%, transparent 70%)",
        borderRadius: "50%", pointerEvents: "none", zIndex: 0,
      }} />
      <div className="auth-orb" style={{
        position: "fixed", bottom: "10%", right: "6%",
        width: 320, height: 320,
        background: "radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)",
        borderRadius: "50%", pointerEvents: "none", zIndex: 0,
      }} />

      {/* ── Logo mark ── */}
      <div ref={logoRef} style={{ marginBottom: 16, zIndex: 1 }}>
        <div style={{
          width: 48, height: 48,
          background: "linear-gradient(135deg, #4f7cff 0%, #8b5cf6 100%)",
          borderRadius: 14,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "1.5rem",
          boxShadow: "0 8px 32px rgba(79,124,255,0.35)",
        }}>
          ✦
        </div>
      </div>

      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-subtitle">Sign in to ContextAI</p>

      {/* ── Card ── */}
      <div ref={cardRef} className="glass-panel auth-card" style={{ padding: "32px 28px", zIndex: 1 }}>
        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 18 }}>

          <div className="form-field">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your_username"
              required
            />
          </div>

          <div className="form-field">
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={{ cursor: "pointer" }}>
              <option value="" disabled>Select role…</option>
              <option value="student">Student</option>
              <option value="faculty">Faculty Member</option>
            </select>
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
                Signing in…
              </>
            ) : "Sign In"}
          </button>
        </form>

        {/* ── Divider ── */}
        <div className="auth-divider divider" style={{ marginTop: 20 }}>or continue with</div>

        {/* ── Google ── */}
        <div className="auth-google-section" style={{ display: "flex", justifyContent: "center", minHeight: 42 }}>
          {GOOGLE_CLIENT_ID ? (
            <div id="google-login-btn" />
          ) : (
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.82rem", textAlign: "center" }}>
              Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-in.
            </p>
          )}
          {GOOGLE_CLIENT_ID && !googleReady && (
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.82rem" }}>Loading Google…</p>
          )}
        </div>

        {/* ── Footer ── */}
        <p className="auth-footer" style={{
          marginTop: 24, textAlign: "center", fontSize: "0.88rem",
          color: "var(--text-secondary)",
        }}>
          No account yet?{" "}
          <a href="/register" style={{ color: "var(--accent-color)", textDecoration: "none", fontWeight: 600 }}>
            Register
          </a>
        </p>
      </div>
    </div>
  );
}