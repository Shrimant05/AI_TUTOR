"use client";

import { useState } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
      setError("Username is required");
      return;
    }
    try {
      const res = await axios.post("http://localhost:8000/api/auth/login", {
        username: normalizedUsername,
        password
      });
      localStorage.setItem("token", res.data.access_token);
      localStorage.setItem("role", res.data.role);
      localStorage.setItem("username", res.data.username);
      
      if (res.data.role === "faculty") {
        router.push("/dashboard");
      } else {
        router.push("/");
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed");
    }
  };

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
        
        <div style={{marginTop: '20px', textAlign: 'center', fontSize: '0.9rem'}}>
          <p>Don't have an account? <a href="/register" style={{color: 'var(--accent-color)', textDecoration: 'none'}}>Register</a></p>
        </div>
      </div>
    </div>
  );
}
