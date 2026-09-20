const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

function loadDecks() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'words.json'));
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading words.json, using fallback');
    return [{ category: 'Default', word: 'Coffee', image: '' }];
  }
}

const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ playerName }) => {
    const roomId = generateRoomCode();
    rooms[roomId] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName, isHost: true, role: null }],
      state: 'LOBBY',
      currentCard: null,
      votes: {},
      clues: []
    };
    socket.join(roomId);
    socket.emit('room_joined', { roomId, isHost: true });
    io.to(roomId).emit('player_list_updated', rooms[roomId].players);
  });

  socket.on('join_room', ({ roomId, playerName }) => {
    const code = roomId.trim().toUpperCase();
    const room = rooms[code];

    if (!room) {
      return socket.emit('error_message', 'Room not found. Check the code.');
    }
    if (room.state !== 'LOBBY') {
      return socket.emit('error_message', 'Game is already in progress.');
    }

    room.players.push({ id: socket.id, name: playerName, isHost: false, role: null });
    socket.join(code);
    socket.emit('room_joined', { roomId: code, isHost: false });
    io.to(code).emit('player_list_updated', room.players);
  });

  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 3) {
      return socket.emit('error_message', 'Need at least 3 players to start.');
    }

    const decks = loadDecks();
    room.currentCard = decks[Math.floor(Math.random() * decks.length)];
    const impostorIndex = Math.floor(Math.random() * room.players.length);

    room.players.forEach((player, idx) => {
      player.role = idx === impostorIndex ? 'IMPOSTOR' : 'CITIZEN';
    });

    room.state = 'CLUE_PHASE';
    room.votes = {};
    room.clues = [];

    room.players.forEach((p) => {
      if (p.role === 'IMPOSTOR') {
        io.to(p.id).emit('round_started', {
          role: 'IMPOSTOR',
          category: room.currentCard.category,
          word: '??? (You are the Impostor!)',
          image: null
        });
      } else {
        io.to(p.id).emit('round_started', {
          role: 'CITIZEN',
          category: room.currentCard.category,
          word: room.currentCard.word,
          image: room.currentCard.image
        });
      }
    });

    io.to(roomId).emit('phase_changed', { phase: 'CLUE_PHASE', players: room.players });
  });

  socket.on('send_clue', ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room || room.state !== 'CLUE_PHASE') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const clueEntry = { name: player.name, text };
    room.clues.push(clueEntry);
    io.to(roomId).emit('new_clue', clueEntry);
  });

  socket.on('begin_voting', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;

    room.state = 'VOTING_PHASE';
    io.to(roomId).emit('phase_changed', { phase: 'VOTING_PHASE', players: room.players });
  });

  socket.on('cast_vote', ({ roomId, votedPlayerId }) => {
    const room = rooms[roomId];
    if (!room || room.state !== 'VOTING_PHASE') return;

    room.votes[socket.id] = votedPlayerId;

    if (Object.keys(room.votes).length === room.players.length) {
      const counts = {};
      Object.values(room.votes).forEach(id => {
        counts[id] = (counts[id] || 0) + 1;
      });

      let highestVotes = 0;
      let accusedId = null;
      for (const [id, count] of Object.entries(counts)) {
        if (count > highestVotes) {
          highestVotes = count;
          accusedId = id;
        }
      }

      const accused = room.players.find(p => p.id === accusedId);
      const impostor = room.players.find(p => p.role === 'IMPOSTOR');

      room.state = 'GAME_OVER';
      io.to(roomId).emit('game_over', {
        accusedName: accused ? accused.name : 'Tie / Nobody',
        impostorName: impostor.name,
        secretWord: room.currentCard.word,
        impostorFound: accusedId === impostor.id
      });
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          delete rooms[roomId];
        } else {
          if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
            room.players[0].isHost = true;
          }
          io.to(roomId).emit('player_list_updated', room.players);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
