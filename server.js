const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

function loadAllDecks() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data) && data.length > 0) return data;
  } catch (err) {
    console.error('Error reading words.json');
  }
  return [
    { category: 'Landmarks', word: 'Taj Mahal', image: 'https://images.unsplash.com/photo-1564507592333-c60657eea523?w=600' },
    { category: 'Vehicles', word: 'Helicopter', image: 'https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=600' }
  ];
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getSanitizedRoom(room, forPlayerId) {
  if (!room) return null;
  const self = room.players.find(p => p.id === forPlayerId);
  return {
    roomId: room.roomId,
    state: room.state,
    hostId: room.hostId,
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
    turnIndex: room.turnIndex,
    activePlayer: room.players[room.turnIndex] ? { id: room.players[room.turnIndex].id, name: room.players[room.turnIndex].name } : null,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isHost: p.id === room.hostId,
      connected: p.connected
    })),
    clues: room.clues,
    secretCard: self ? (self.role === 'IMPOSTOR' ? { role: 'IMPOSTOR' } : {
      role: 'CITIZEN',
      category: room.currentCard ? room.currentCard.category : '',
      word: room.currentCard ? room.currentCard.word : '',
      image: room.currentCard ? room.currentCard.image : ''
    }) : null,
    votesCount: Object.keys(room.votes).length,
    totalVoters: room.players.length,
    gameOverData: room.state === 'GAME_OVER' ? room.gameOverData : null
  };
}

io.on('connection', (socket) => {
  socket.on('resume_session', ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('session_resume_failed');

    const player = room.players.find(p => p.id === playerId);
    if (!player) return socket.emit('session_resume_failed');

    player.socketId = socket.id;
    player.connected = true;
    socket.join(roomId);
    socket.playerId = player.id;
    socket.roomId = roomId;

    socket.emit('session_resumed', getSanitizedRoom(room, player.id));
    io.to(roomId).emit('room_sync', {
      players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, isHost: p.id === room.hostId, connected: p.connected }))
    });
  });

  socket.on('create_room', ({ playerName, avatar, playerId }) => {
    const roomId = generateRoomCode();
    rooms[roomId] = {
      roomId,
      hostId: playerId,
      players: [{ id: playerId, socketId: socket.id, name: playerName, avatar: avatar || 0, role: null, connected: true }],
      pastImpostors: [],
      deckPool: shuffleArray(loadAllDecks()),
      state: 'LOBBY',
      currentCard: null,
      currentRound: 1,
      totalRounds: 3,
      turnIndex: 0,
      clues: [],
      votes: {},
      gameOverData: null,
      countdownTimer: null
    };

    socket.playerId = playerId;
    socket.roomId = roomId;
    socket.join(roomId);

    socket.emit('room_created', { roomId, playerId });
    socket.emit('full_state_update', getSanitizedRoom(rooms[roomId], playerId));
  });

  socket.on('join_room', ({ roomId, playerName, avatar, playerId }) => {
    const code = (roomId || '').trim().toUpperCase();
    const room = rooms[code];

    if (!room) return socket.emit('error_message', 'Room code not found.');
    if (room.state !== 'LOBBY') return socket.emit('error_message', 'Match already in progress.');

    const existing = room.players.find(p => p.id === playerId);
    if (!existing) {
      room.players.push({
        id: playerId,
        socketId: socket.id,
        name: playerName,
        avatar: avatar || 0,
        role: null,
        connected: true
      });
    } else {
      existing.socketId = socket.id;
      existing.name = playerName;
      existing.avatar = avatar || existing.avatar;
      existing.connected = true;
    }

    socket.playerId = playerId;
    socket.roomId = code;
    socket.join(code);

    socket.emit('room_joined', { roomId: code, playerId });
    room.players.forEach(p => {
      io.to(p.socketId).emit('full_state_update', getSanitizedRoom(room, p.id));
    });
  });

  socket.on('start_game', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.playerId) return;
    if (room.players.length < 3) {
      return socket.emit('error_message', 'At least 3 players required.');
    }

    if (!room.deckPool || room.deckPool.length === 0) {
      room.deckPool = shuffleArray(loadAllDecks());
    }
    room.currentCard = room.deckPool.pop();

    let eligible = room.players.filter(p => !room.pastImpostors.includes(p.id));
    if (eligible.length === 0) {
      room.pastImpostors = [];
      eligible = room.players;
    }
    const chosenImpostor = eligible[Math.floor(Math.random() * eligible.length)];
    room.pastImpostors.push(chosenImpostor.id);

    room.players.forEach(p => {
      p.role = (p.id === chosenImpostor.id) ? 'IMPOSTOR' : 'CITIZEN';
    });

    room.state = 'CLUE_PHASE';
    room.currentRound = 1;
    room.totalRounds = 3;
    room.turnIndex = 0;
    room.clues = [];
    room.votes = {};
    room.gameOverData = null;

    room.players.forEach(p => {
      io.to(p.socketId).emit('full_state_update', getSanitizedRoom(room, p.id));
    });
  });

  socket.on('submit_clue', ({ text }) => {
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'CLUE_PHASE') return;

    const currentTurnPlayer = room.players[room.turnIndex];
    if (!currentTurnPlayer || currentTurnPlayer.id !== socket.playerId) {
      return socket.emit('error_message', 'Wait for your turn!');
    }

    const cleanText = (text || '').trim();
    if (!cleanText) return;

    room.clues.push({
      round: room.currentRound,
      playerName: currentTurnPlayer.name,
      playerId: currentTurnPlayer.id,
      text: cleanText
    });

    room.turnIndex++;
    if (room.turnIndex >= room.players.length) {
      room.turnIndex = 0;
      room.currentRound++;
    }

    if (room.currentRound > room.totalRounds) {
      room.state = 'VOTING_PHASE';
    }

    room.players.forEach(p => {
      io.to(p.socketId).emit('full_state_update', getSanitizedRoom(room, p.id));
    });
  });

  socket.on('submit_vote', ({ suspectId, reason }) => {
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'VOTING_PHASE') return;

    if (!suspectId || !reason || !reason.trim()) {
      return socket.emit('error_message', 'Pick a suspect and provide your reason.');
    }

    room.votes[socket.playerId] = {
      voterId: socket.playerId,
      suspectId,
      reason: reason.trim()
    };

    room.players.forEach(p => {
      io.to(p.socketId).emit('vote_progress', {
        votesCount: Object.keys(room.votes).length,
        totalVoters: room.players.length
      });
    });

    if (Object.keys(room.votes).length === room.players.length) {
      room.state = 'COUNTDOWN';
      let secondsLeft = 10;
      io.to(room.roomId).emit('start_reveal_countdown', { count: secondsLeft });

      room.countdownTimer = setInterval(() => {
        secondsLeft--;
        if (secondsLeft > 0) {
          io.to(room.roomId).emit('countdown_tick', { count: secondsLeft });
        } else {
          clearInterval(room.countdownTimer);

          const counts = {};
          Object.values(room.votes).forEach(v => {
            counts[v.suspectId] = (counts[v.suspectId] || 0) + 1;
          });

          let maxVotes = 0;
          let accusedId = null;
          let isTie = false;

          for (const [sId, count] of Object.entries(counts)) {
            if (count > maxVotes) {
              maxVotes = count;
              accusedId = sId;
              isTie = false;
            } else if (count === maxVotes) {
              isTie = true;
            }
          }

          const impostor = room.players.find(p => p.role === 'IMPOSTOR');
          const impostorCaught = !isTie && (accusedId === impostor.id);

          const winningPlayers = [];
          Object.values(room.votes).forEach(v => {
            if (v.suspectId === impostor.id) {
              const voter = room.players.find(p => p.id === v.voterId);
              if (voter && !winningPlayers.some(w => w.id === voter.id)) {
                winningPlayers.push({
                  id: voter.id,
                  name: voter.name,
                  avatar: voter.avatar,
                  title: 'Eagle-Eyed Detective'
                });
              }
            }
          });

          if (!impostorCaught) {
            winningPlayers.unshift({
              id: impostor.id,
              name: impostor.name,
              avatar: impostor.avatar,
              title: 'The Master Impostor'
            });
          }

          const detailedVotes = Object.values(room.votes).map(v => {
            const voter = room.players.find(p => p.id === v.voterId);
            const suspect = room.players.find(p => p.id === v.suspectId);
            return {
              voterName: voter ? voter.name : 'Unknown',
              suspectName: suspect ? suspect.name : 'Unknown',
              reason: v.reason
            };
          });

          room.state = 'GAME_OVER';
          room.gameOverData = {
            impostorCaught,
            impostorName: impostor.name,
            secretWord: room.currentCard.word,
            secretCategory: room.currentCard.category,
            winningPlayers,
            detailedVotes
          };

          room.players.forEach(p => {
            io.to(p.socketId).emit('full_state_update', getSanitizedRoom(room, p.id));
          });
        }
      }, 1000);
    }
  });

  socket.on('play_again', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.playerId) return;

    room.state = 'LOBBY';
    room.currentCard = null;
    room.currentRound = 1;
    room.turnIndex = 0;
    room.clues = [];
    room.votes = {};
    room.gameOverData = null;

    room.players.forEach(p => {
      p.role = null;
      io.to(p.socketId).emit('full_state_update', getSanitizedRoom(room, p.id));
    });
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (!room) return;

    const p = room.players.find(x => x.id === socket.playerId);
    if (p) p.connected = false;

    const anyConnected = room.players.some(x => x.connected);
    if (!anyConnected) {
      if (room.countdownTimer) clearInterval(room.countdownTimer);
      delete rooms[socket.roomId];
    } else {
      if (room.hostId === socket.playerId) {
        const nextHost = room.players.find(x => x.connected);
        if (nextHost) room.hostId = nextHost.id;
      }
      room.players.forEach(player => {
        if (player.connected) {
          io.to(player.socketId).emit('full_state_update', getSanitizedRoom(room, player.id));
        }
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server online on ${PORT}`));
