"use client";

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import { loadAuthSession, saveAuthSession, syncAuthSessionWithServer, clearAuthSession } from '../../lib/authStorage';

export default function Register() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("student");
  const [error, setError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const router = useRouter();

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

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    const normalizedUsername = username.trim();
    const normalizedRole = role.trim().toLowerCase();
    if (!normalizedUsername) {
      setError("Username is required");
      return;
    }
    try {
      await axios.post("http://localhost:8000/api/auth/register", {
        username: normalizedUsername,
        password,
        role: normalizedRole
      });
      // After registering, automatically ping the login endpoint
      const res = await axios.post("http://localhost:8000/api/auth/login", {
        username: normalizedUsername,
        password
      });
      saveAuthSession({
        token: res.data.access_token,
        role: res.data.role,
        username: res.data.username,
      });
      
      if (res.data.role === "faculty") {
        router.push("/dashboard");
      } else {
        router.push("/");
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Registration failed");
    }
  };

  if (checkingSession) {
    return <div style={{padding: '50px', textAlign: 'center'}}>Loading...</div>;
  }

  return (
    <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', flexDirection: 'column'}}>
      <h1 style={{fontSize: '2.5rem', marginBottom: '10px'}}>Join ContextAI</h1>
      <p style={{color: 'var(--text-secondary)', marginBottom: '30px'}}>Create your account</p>
      
      <div className="glass-panel" style={{width: '100%', maxWidth: '400px', padding: '30px'}}>
        <form onSubmit={handleRegister} style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
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
            <label style={{display: 'block', marginBottom: '8px'}}>Password</label>
            <input 
              type="password" 
              className="chat-input" 
              value={password} onChange={(e) => setPassword(e.target.value)} 
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
              <option value="student">Student</option>
              <option value="faculty">Faculty Member</option>
            </select>
          </div>
          
          {error && <p style={{color: 'var(--danger)', fontSize: '0.9rem', margin: 0}}>{error}</p>}
          
          <button type="submit" className="send-btn" style={{width: '100%', padding: '12px', justifyContent: 'center'}}>
            Register
          </button>
        </form>
        
        <div style={{marginTop: '20px', textAlign: 'center', fontSize: '0.9rem'}}>
          <p>Already have an account? <a href="/login" style={{color: 'var(--accent-color)', textDecoration: 'none'}}>Sign In</a></p>
        </div>
      </div>
    </div>
  );
}
