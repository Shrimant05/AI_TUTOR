"use client";

import { useState, useEffect } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import { UploadCloud, FileText, Users, AlertTriangle, Trash2, Database, LogOut, Plus, BookOpen } from 'lucide-react';
import { loadAuthSession, clearAuthSession, syncAuthSessionWithServer } from '../../lib/authStorage';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function Dashboard() {
  const router = useRouter();
  const [auth, setAuth] = useState(null);
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  
  const [stats, setStats] = useState({
    total_queries: 0, active_students: 0, heatmap_data: [], student_activity: []
  });
  const [notes, setNotes] = useState([]);
  
  const [uploading, setUploading] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [newRoomName, setNewRoomName] = useState("");

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

      if (activeSession.role !== "faculty") {
        router.push("/");
        return;
      }

      setAuth(activeSession);
      fetchClassrooms();
    };

    initializeAuth();
  }, []);

  useEffect(() => {
    if (!selectedClassroom) return;
    
    fetchStats();
    fetchNotes();
    const interval = setInterval(() => {
      fetchStats();
      fetchNotes();
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedClassroom]);

  const fetchClassrooms = async () => {
    try {
      const res = await axios.get(`http://localhost:8000/api/classrooms?t=${new Date().getTime()}`);
      const fetchedClassrooms = res.data.classrooms || [];
      setClassrooms(fetchedClassrooms);
      if (fetchedClassrooms.length > 0 && !selectedClassroom) {
        setSelectedClassroom(fetchedClassrooms[fetchedClassrooms.length - 1]); // Auto-select most recent one on initial load
      }
      return fetchedClassrooms;
    } catch (e) {
      if (e.response?.status === 401) {
        clearAuthSession();
        router.push("/login");
      }
      return [];
    }
  };

  const handleCreateClassroom = async () => {
    const roomName = newRoomName.trim();
    if (!roomName) {
      alert("Please enter a requested room name before clicking Create.");
      return;
    }

    setCreatingRoom(true);
    setActionMessage("Creating classroom...");
    try {
      await axios.post("http://localhost:8000/api/classrooms", { name: roomName });
      setNewRoomName("");

      const refreshedClassrooms = await fetchClassrooms();
      const createdRoom = [...refreshedClassrooms]
        .filter(c => c.name === roomName)
        .sort((a, b) => b.id - a.id)[0];

      if (createdRoom) {
        setSelectedClassroom(createdRoom);
      }

      setActionMessage(`Success! Classroom "${roomName}" created.`);
    } catch (e) {
      const errorMessage = "Failed to create classroom: " + (e.response?.data?.detail || e.message);
      setActionMessage(errorMessage);
      alert(errorMessage);
    } finally {
      setCreatingRoom(false);
    }
  };

  const fetchStats = async () => {
    try {
      if (!selectedClassroom) return;
      const res = await axios.get(`http://localhost:8000/api/dashboard/stats?classroom_id=${selectedClassroom.id}`);
      setStats(res.data);
    } catch (e) {}
  };

  const fetchNotes = async () => {
    try {
      if (!selectedClassroom) return;
      const res = await axios.get(`http://localhost:8000/api/notes?classroom_id=${selectedClassroom.id}&t=${new Date().getTime()}`);
      setNotes(res.data.notes || []);
    } catch (e) {}
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedClassroom) return;
    setUploading(true);
    setActionMessage("Uploading & Indexing into Vector DB...");
    
    const formData = new FormData();
    formData.append("file", file);
    formData.append("classroom_id", selectedClassroom.id);

    try {
      await axios.post("http://localhost:8000/api/upload_notes", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setActionMessage(`Success! Indexed ${file.name}`);
      fetchNotes();
    } catch (err) {
      setActionMessage("Failed to upload document.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteNote = async (filename) => {
    if (!selectedClassroom || !confirm(`Are you sure you want to delete ${filename}?`)) return;
    setActionMessage(`Deleting ${filename}...`);
    try {
      await axios.delete(`http://localhost:8000/api/notes/${filename}?classroom_id=${selectedClassroom.id}`);
      setActionMessage(`Successfully deleted ${filename}`);
      fetchNotes();
    } catch (err) {
      setActionMessage("Failed to delete document.");
    }
  };

  const handleLogout = () => {
    clearAuthSession();
    router.push("/login");
  };

  if (!auth) return <div style={{padding: '50px', textAlign: 'center'}}>Loading...</div>;

  const chartData = {
    labels: stats.heatmap_data.map(d => d.topic),
    datasets: [{
      label: 'Confusion Rank',
      data: stats.heatmap_data.map(d => d.score),
      backgroundColor: 'rgba(239, 68, 68, 0.7)',
      borderColor: 'rgba(239, 68, 68, 1)',
      borderWidth: 1,
    }]
  };

  return (
    <div style={{maxWidth: '1200px', margin: '0 auto', width: '100%', paddingBottom: '50px'}}>
      
      {/* Header */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px'}}>
        <div>
          <h1 style={{fontSize: '2rem', fontWeight: 600, margin: 0}}>Faculty Dashboard</h1>
          <p style={{color: 'var(--text-secondary)', margin: '5px 0 0 0'}}>Welcome, Professor {auth.username}</p>
        </div>
        <button onClick={handleLogout} className="send-btn" style={{background: 'rgba(255,100,100,0.1)', color: 'var(--danger)', padding: '8px 16px', gap: '8px', alignItems: 'center'}}>
          <LogOut size={16} /> Logout
        </button>
      </div>
      
      {/* Classrooms Selector & Creator */}
      <div className="dashboard-grid" style={{marginBottom: '20px'}}>
        <div className="glass-panel" style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
          <h3 style={{margin: 0}}><BookOpen size={20} style={{verticalAlign: 'middle', marginRight: '8px'}} /> My Classrooms</h3>
          
          <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
            {classrooms.length === 0 ? <p style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>No classrooms yet. Create one below!</p> :
              classrooms.map(c => (
                <div 
                  key={c.id} 
                  onClick={() => setSelectedClassroom(c)}
                  style={{
                    padding: '12px 20px', borderRadius: '8px', cursor: 'pointer',
                    background: selectedClassroom?.id === c.id ? 'var(--accent-color)' : 'rgba(255,255,255,0.05)',
                    border: '1px solid',
                    borderColor: selectedClassroom?.id === c.id ? 'var(--accent-color)' : 'var(--panel-border)',
                    transition: '0.2s'
                  }}
                >
                  <div style={{fontWeight: 600, color: '#fff'}}>{c.name}</div>
                  <div style={{fontSize: '0.8rem', color: selectedClassroom?.id === c.id ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)'}}>
                    Join Code: <strong style={{letterSpacing: '1px'}}>{c.join_code}</strong>
                  </div>
                </div>
              ))
            }
          </div>

          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
            <input 
              type="text" 
              placeholder="E.g. CS 101 - Fall 2026 (Required)" 
              className="chat-input" 
              value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreateClassroom();
                }
              }}
              style={{flex: 1}}
            />
            <button
              type="button"
              onClick={handleCreateClassroom}
              className="send-btn"
              style={{padding: '0 20px'}}
              disabled={creatingRoom}
            >
              <Plus size={18} /> {creatingRoom ? 'Creating...' : 'Create Room'}
            </button>
          </div>
        </div>
      </div>

      {selectedClassroom ? (
        <>
          <div className="dashboard-grid">
            <div className="stat-card glass-panel">
              <h3><FileText size={20} style={{verticalAlign: 'middle', marginRight: '8px'}}/> Total Queries Handled</h3>
              <p className="value">{stats.total_queries}</p>
            </div>
            <div className="stat-card glass-panel">
              <h3><Users size={20} style={{verticalAlign: 'middle', marginRight: '8px'}}/> Active Students</h3>
              <p className="value">{stats.active_students}</p>
            </div>
          </div>

          <div className="dashboard-grid" style={{ gridTemplateColumns: 'minmax(400px, 2fr) minmax(300px, 1fr)' }}>
            <div className="glass-panel chart-container">
              <h3 style={{marginBottom: '20px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px'}}>
                 Heatmap: Weakest Concepts in {selectedClassroom.name}
              </h3>
              <Bar 
                data={chartData} 
                options={{ 
                  responsive: true,
                  plugins: { legend: { position: 'top' }, title: { display: false } },
                  scales: { y: { beginAtZero: true, display: false } }
                }} 
              />
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
              <div className="glass-panel upload-panel">
                <h3 style={{margin: 0}}>Classroom Materials</h3>
                <p style={{color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0, paddingBottom: '15px'}}>
                  Upload PDFs to explicitly ground AI answers for this room.
                </p>
                <label style={{cursor: 'pointer', display: 'inline-block', marginBottom: '15px'}}>
                  <div style={{
                    background: 'var(--accent-color)', padding: '12px 24px', borderRadius: '8px',
                    display: 'inline-flex', alignItems: 'center', gap: '10px', color: '#fff'
                  }}>
                    <UploadCloud size={20} />
                    {uploading ? 'Processing...' : 'Upload Notes'}
                  </div>
                  <input type="file" accept=".pdf,.txt" onChange={handleFileUpload} style={{display: 'none'}} disabled={uploading} />
                </label>

                <div>
                  <h4 style={{fontSize: '1rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <Database size={16}/> Active Vector Documents
                  </h4>
                  {notes.length === 0 ? (
                    <p style={{fontSize: '0.85rem', color: 'var(--text-secondary)'}}>No materials uploaded yet.</p>
                  ) : (
                    <ul style={{listStyle: 'none', padding: 0, margin: 0}}>
                      {notes.map(note => (
                        <li key={note} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '8px 12px', background: 'rgba(255,255,255,0.05)', 
                          borderRadius: '6px', marginBottom: '8px', fontSize: '0.9rem'
                        }}>
                          <span style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%'}}>
                            {note}
                          </span>
                          <button 
                            onClick={() => handleDeleteNote(note)}
                            style={{background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px'}}
                            title="Delete and Purge Vectors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {actionMessage && (
                  <div style={{marginTop: '15px', fontSize: '0.9rem', color: actionMessage.includes('Success') ? 'var(--success)' : 'var(--danger)'}}>
                    {actionMessage}
                  </div>
                )}
              </div>

              <div className="glass-panel" style={{padding: '20px', flex: 1}}>
                <h3 style={{marginBottom: '15px'}}><AlertTriangle size={18} style={{verticalAlign: 'middle'}}/> Activity Feed</h3>
                {stats.student_activity.length === 0 ? (
                  <p style={{color: 'var(--text-secondary)', fontSize: '0.9rem'}}>No student activity yet.</p>
                ) : (
                  <ul style={{listStyle: 'none', padding: 0, margin: 0}}>
                    {stats.student_activity.map((s, i) => (
                      <li key={i} style={{padding: '10px 0', borderBottom: 'i px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between'}}>
                        <span>User Hash #{s.user.substring(0,8)}</span>
                        <span style={{color: 'var(--text-secondary)'}}>{s.count} queries</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div style={{textAlign: 'center', padding: '50px', color: 'var(--text-secondary)'}}>
           Select or create a classroom above to manage it.
        </div>
      )}
    </div>
  );
}
