"use client";

import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import { loadAuthSession, saveAuthSession, syncAuthSessionWithServer, clearAuthSession } from '../../lib/authStorage';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [googleReady, setGoogleReady] = useState(false);
  const router = useRouter();
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

    if (authData.role === "faculty") {
      router.push("/dashboard");
    } else {
      router.push("/");
    }
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
      if (!session.token) {
        setCheckingSession(false);
        return;
      }

      const synced = await syncAuthSessionWithServer(session.token);
      if (!synced) {
        clearAuthSession();
        setCheckingSession(false);
        return;
      }

      const active = synced || session;
      if ((active.role || "").toLowerCase() === "faculty") {
        router.push("/dashboard");
        return;
      }

      if ((active.role || "").toLowerCase() === "student") {
        router.push("/");
        return;
      }

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
          if (response?.credential) {
            handleGoogleCredential(response.credential);
          }
        },
      });

      const container = document.getElementById("google-login-btn");
      if (container) {
        container.innerHTML = "";
        window.google.accounts.id.renderButton(container, {
          theme: "outline",
          size: "large",
          width: "320",
          text: "signin_with",
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
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
      setError("Username is required");
      return;
    }
    if (!["student", "faculty"].includes((role || "").toLowerCase())) {
      setError("Please select your role");
      return;
    }
    try {
      const form = new URLSearchParams();
      form.append("username", normalizedUsername);
      form.append("password", password);

      const res = await axios.post("http://localhost:8000/api/auth/token", form, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      if ((res.data.role || "").toLowerCase() !== role.toLowerCase()) {
        setError(`This account is registered as ${res.data.role}. Please choose the correct role.`);
        return;
      }

      finalizeLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed");
    }
  };

  if (checkingSession) {
    return <div style={{padding: '50px', textAlign: 'center'}}>Loading...</div>;
  }

  return (
    <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', flexDirection: 'column'}}>
      <h1 style={{fontSize: '2.5rem', marginBottom: '10px'}}>Welcome to ContextAI</h1>
      <p style={{color: 'var(--text-secondary)', marginBottom: '30px'}}>Sign in to continue</p>
      
      <div className="glass-panel" style={{width: '100%', maxWidth: '400px', padding: '30px'}}>
        <form onSubmit={handleLogin} style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
          <div>
            <label style={{display: 'block', marginBottom: '8px'}}>Username</label>
            <input 
              type="text" 
              className="chat-input" 
              value={username} onChange={(e) => setUsername(e.target.value)} 
              required 
            />
          </div>
          <div>
            <label style={{display: 'block', marginBottom: '8px'}}>I am a...</label>
            <select
              className="chat-input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={{cursor: 'pointer'}}
            >
              <option value="" disabled>Select role</option>
              <option value="student">Student</option>
              <option value="faculty">Faculty Member</option>
            </select>
          </div>
          <div>
            <label style={{display: 'block', marginBottom: '8px'}}>Password</label>
            <input 
              type="password" 
              className="chat-input" 
              value={password} onChange={(e) => setPassword(e.target.value)} 
              required 
            />
          </div>
          
          {error && <p style={{color: 'var(--danger)', fontSize: '0.9rem', margin: 0}}>{error}</p>}
          
          <button type="submit" className="send-btn" style={{width: '100%', padding: '12px', justifyContent: 'center'}}>
            Sign In
          </button>
        </form>

        <div style={{marginTop: '16px', marginBottom: '6px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem'}}>
          or
        </div>
        {GOOGLE_CLIENT_ID ? (
          <div style={{display: 'flex', justifyContent: 'center'}}>
            <div id="google-login-btn" style={{minHeight: '42px'}} />
          </div>
        ) : (
          <p style={{margin: 0, textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem'}}>
            Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-in.
          </p>
        )}
        {GOOGLE_CLIENT_ID && !googleReady && (
          <p style={{margin: '8px 0 0 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem'}}>
            Loading Google sign-in...
          </p>
        )}
        {GOOGLE_CLIENT_ID && (
          <p style={{margin: '8px 0 0 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem'}}>
            Existing Google users sign in with saved profile; new Google users must provide name and role.
          </p>
        )}
        
        <div style={{marginTop: '20px', textAlign: 'center', fontSize: '0.9rem'}}>
          <p>Don&apos;t have an account? <a href="/register" style={{color: 'var(--accent-color)', textDecoration: 'none'}}>Register</a></p>
        </div>
      </div>
    </div>
  );
}
