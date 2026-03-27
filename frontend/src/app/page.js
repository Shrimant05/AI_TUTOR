"use client";

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Send, UploadCloud, Book, Hash, LogOut, ArrowLeft, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { loadAuthSession, clearAuthSession, syncAuthSessionWithServer } from '../lib/authStorage';

export default function Home() {
  const router = useRouter();
  const [auth, setAuth] = useState(null);
  
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  
  const messagesEndRef = useRef(null);

  // Auto-scroll chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => scrollToBottom(), [messages]);

  useEffect(() => {
    const initializeAuth = async () => {
      const { token, role, username } = loadAuthSession();

      if (!token) {
        router.push("/login");
        return;
      }

      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      const synced = await syncAuthSessionWithServer(token);
      if (!synced) {
        clearAuthSession();
        router.push("/login");
        return;
      }
      const activeSession = synced || { token, role, username };

      if ((activeSession.role || "").toLowerCase() === "faculty") {
        router.push("/dashboard");
        return;
      }

      setAuth(activeSession);

      // Generate unique session for this open tab
      if (!localStorage.getItem("sessionId")) {
        localStorage.setItem("sessionId", "session_" + Math.random().toString(36).substring(7));
      }

      fetchClassrooms();
    };

    initializeAuth();
  }, []);

  const fetchClassrooms = async () => {
    try {
      const res = await axios.get(`http://localhost:8000/api/classrooms?t=${new Date().getTime()}`);
      setClassrooms(res.data.classrooms || []);
    } catch (e) {
      if (e.response?.status === 401) {
        clearAuthSession();
        router.push("/login");
      }
    }
  };

  const handleJoinClassroom = async (e) => {
    e.preventDefault();
    if (!joinCode) return;
    try {
      await axios.post("http://localhost:8000/api/classrooms/join", { join_code: joinCode });
      setJoinCode("");
      fetchClassrooms();
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to join classroom");
    }
  };

  const handleSelectClassroom = (c) => {
    setSelectedClassroom(c);
    setMessages([{ role: 'ai', content: `Hello! I am your AI Tutor for **${c.name}**. What would you like to review?` }]);
    fetchNotes(c.id);
    fetchChatHistory(c.id);
  };

  const fetchNotes = async (classroomId) => {
    try {
      const res = await axios.get(`http://localhost:8000/api/notes?classroom_id=${classroomId}&t=${new Date().getTime()}`);
      setNotes(res.data.notes || []);
    } catch (err) {
      console.error("Failed to fetch available notes", err);
    }
  };

  const fetchChatHistory = async (classroomId) => {
    if (!classroomId) return;
    setHistoryLoading(true);
    try {
      const res = await axios.get("http://localhost:8000/api/chat/history", {
        params: { classroom_id: String(classroomId), limit: 500 }
      });
      setChatHistory(res.data.items || []);
    } catch (err) {
      console.error("Failed to fetch chat history", err);
      setChatHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !selectedClassroom) return;
    
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput("");
    setLoading(true);

    const sessionId = localStorage.getItem("sessionId");
    
    try {
      const response = await axios.post("http://localhost:8000/api/chat", {
        classroom_id: String(selectedClassroom.id),
        session_id: sessionId,
        query: userMsg,
        history: messages.map(m => ({ role: m.role, content: m.content }))
      });
      
      setMessages(prev => [...prev, { 
        role: 'ai', 
        content: response.data.reply,
        citations: response.data.citations 
      }]);
      fetchChatHistory(selectedClassroom.id);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'ai', content: "An error occurred connecting to the tutor." }]);
    }
    setLoading(false);
  };

  const handleLogout = () => {
    clearAuthSession();
    router.push("/login");
  };

  if (!auth) return <div style={{padding: '50px', textAlign: 'center'}}>Loading...</div>;

  // View 1: Classroom Selection
  if (!selectedClassroom) {
    return (
      <div style={{maxWidth: '800px', margin: '0 auto', width: '100%', paddingTop: '40px'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px'}}>
          <h1 style={{fontSize: '2.5rem'}}>Welcome, {auth.username}</h1>
          <button onClick={handleLogout} className="send-btn" style={{background: 'rgba(255,100,100,0.1)', color: 'var(--danger)', gap: '8px'}}>
            <LogOut size={16} /> Logout
          </button>
        </div>

        {auth.role === "faculty" && (
          <div style={{marginBottom: '30px', padding: '20px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px'}}>
            You are logged in as a Faculty member. 
            <button onClick={() => router.push('/dashboard')} className="send-btn" style={{marginTop: '10px'}}>
              Go to Faculty Dashboard
            </button>
          </div>
        )}

        <div className="glass-panel" style={{marginBottom: '30px', padding: '30px'}}>
          <h2>Join a Course</h2>
          <form onSubmit={handleJoinClassroom} style={{display: 'flex', gap: '15px', marginTop: '15px'}}>
            <input 
              type="text" 
              placeholder="Enter 6-digit Join Code" 
              className="chat-input"
              value={joinCode} onChange={e => setJoinCode(e.target.value)}
              style={{flex: 1, fontSize: '1.2rem', textTransform: 'uppercase'}}
              maxLength={6}
            />
            <button type="submit" className="send-btn"><Plus size={18}/> Join</button>
          </form>
        </div>

        <h2 style={{marginBottom: '20px'}}>My Enrolled Courses</h2>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px'}}>
          {classrooms.length === 0 ? <p style={{color: 'var(--text-secondary)'}}>You haven't joined any classrooms yet.</p> :
            classrooms.map(c => (
              <div 
                key={c.id} 
                onClick={() => handleSelectClassroom(c)}
                className="glass-panel stat-card"
                style={{cursor: 'pointer', transition: '0.2s', border: '1px solid transparent'}}
                onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = 'transparent'}
              >
                <h3 style={{fontSize: '1.2rem', margin: '0 0 10px 0'}}>{c.name}</h3>
              </div>
            ))
          }
        </div>
      </div>
    );
  }

  // View 2: Chat Interface
  return (
    <div className="layout-container">
      {/* Main Chat Area */}
      <main className="chat-container">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', borderBottom: '1px solid var(--panel-border)', marginBottom: '15px'}}>
          <h2 style={{fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0}}>
            <Book size={18} /> {selectedClassroom.name}
          </h2>
          <button onClick={() => setSelectedClassroom(null)} style={{background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600}}>
            <ArrowLeft size={16}/> Back
          </button>
        </div>
        <div className="chat-history">
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role === 'user' ? 'user-message' : 'ai-message'}`}>
              <div className="message-bubble">
                <div style={{fontWeight: 600, marginBottom: '5px', fontSize: '0.85rem', opacity: 0.8}}>
                  {msg.role === 'user' ? 'You' : 'AI Tutor'}
                </div>
                {msg.content}
                
                {/* Citations block */}
                {msg.citations && msg.citations.length > 0 && (
                  <div style={{marginTop: '15px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>
                    {msg.citations.map((cite, i) => (
                      <span key={i} style={{display: 'block'}}>
                        (File: {cite.file}, Page: {cite.page})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="message ai-message">
              <div className="message-bubble" style={{opacity: 0.7}}>Tutor is thinking...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="input-area" onSubmit={handleSend}>
          <input 
            type="text" 
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your course notes..."
            disabled={loading}
          />
          <button type="submit" className="send-btn" disabled={loading || !input.trim()}>
            <Send size={18} />
          </button>
        </form>
      </main>
    </div>
  );
}
