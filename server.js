const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize SQLite Database
const db = new sqlite3.Database('./boss_tracker.db');

// Create tables
db.serialize(() => {
  // Rooms table
  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Boss data table
  db.run(`CREATE TABLE IF NOT EXISTS boss_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT,
    boss_id TEXT,
    boss_name TEXT,
    data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_code) REFERENCES rooms (code)
  )`);
});

// API Routes

// Create room
app.post('/api/rooms', (req, res) => {
  const { name } = req.body;
  const code = generateRoomCode();
  
  db.run('INSERT INTO rooms (code, name) VALUES (?, ?)', [code, name], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ code, name, id: this.lastID });
  });
});

// Get room
app.get('/api/rooms/:code', (req, res) => {
  const { code } = req.params;
  
  db.get('SELECT * FROM rooms WHERE code = ?', [code], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    res.json(row);
  });
});

// Save boss data
app.post('/api/rooms/:code/boss-data', (req, res) => {
  const { code } = req.params;
  const { bossId, bossName, data } = req.body;
  
  const query = `INSERT OR REPLACE INTO boss_data (room_code, boss_id, boss_name, data, updated_at) 
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`;
  
  db.run(query, [code, bossId, bossName, JSON.stringify(data)], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    // Emit real-time update to all clients in this room
    io.to(`room_${code}`).emit('bossDataUpdated', {
      bossId,
      bossName,
      data
    });
    
    res.json({ success: true, id: this.lastID });
  });
});

// Get all boss data for a room
app.get('/api/rooms/:code/boss-data', (req, res) => {
  const { code } = req.params;
  
  db.all('SELECT * FROM boss_data WHERE room_code = ? ORDER BY updated_at DESC', [code], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    const bossData = {};
    rows.forEach(row => {
      bossData[row.boss_id] = {
        name: row.boss_name,
        data: JSON.parse(row.data),
        updatedAt: row.updated_at
      };
    });
    
    res.json(bossData);
  });
});

// Socket.IO for real-time updates
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Join room
  socket.on('joinRoom', (roomCode) => {
    socket.join(`room_${roomCode}`);
    console.log(`User ${socket.id} joined room ${roomCode}`);
  });
  
  // Handle boss data updates
  socket.on('updateBossData', (data) => {
    const { roomCode, bossId, bossName, bossData } = data;
    
    // Save to database
    const query = `INSERT OR REPLACE INTO boss_data (room_code, boss_id, boss_name, data, updated_at) 
                   VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`;
    
    db.run(query, [roomCode, bossId, bossName, JSON.stringify(bossData)], function(err) {
      if (err) {
        console.error('Database error:', err);
        return;
      }
      
      // Broadcast to all clients in the room
      io.to(`room_${roomCode}`).emit('bossDataUpdated', {
        bossId,
        bossName,
        data: bossData
      });
    });
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Utility function
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access your app at: http://localhost:${PORT}`);
});