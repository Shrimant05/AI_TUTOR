"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadAuthSession, syncAuthSessionWithServer } from '../lib/authStorage';

export default function RoleSidebarNav() {
  const [role, setRole] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initializeRole = async () => {
      const session = loadAuthSession();
      setHasToken(Boolean(session.token));

      if (!session.token) {
        setRole("");
        setLoading(false);
        return;
      }

      const synced = await syncAuthSessionWithServer(session.token);
      setRole((synced?.role || session.role || "").toLowerCase());
      setLoading(false);
    };

    initializeRole();
  }, []);

  if (loading && hasToken) {
    return <nav style={{display: 'flex', flexDirection: 'column', gap: '10px'}} />;
  }

  return (
    <nav style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
      {role === "faculty" ? (
        <Link href="/dashboard" className="nav-link">📊 Faculty Dashboard</Link>
      ) : role === "student" ? (
        <Link href="/" className="nav-link">💬 Student Chat</Link>
      ) : !hasToken ? (
        <>
          <Link href="/login" className="nav-link">🔐 Sign In</Link>
          <Link href="/register" className="nav-link">🆕 Register</Link>
        </>
      ) : null}
    </nav>
  );
}
