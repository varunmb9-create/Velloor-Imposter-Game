const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 30000,
  pingInterval: 10000
});

app.use(express.static(path.join(__dirname, 'public')));

// Global persistent in-memory leaderboard across matches
const globalLeaderboard = [];
for (let i = 0; i < 8; i++) {
  globalLeaderboard.push({
    avatarIndex: i,
    matches: 0,
    lastPoints: 0,
    points: 0
  });
}

// Built-in topics
const TOPICS = [
  { word: 'Dragon', category: 'Mythical Beast', image: 'https://images.unsplash.com/photo-1577493340887-b7bfff550145?auto=format&fit=crop&w=400&q=80' },
  { word: 'Crown', category: 'Royal Regalia', image: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=400&q=80' },
  { word: 'Castle', category: 'Architecture', image: 'https://images.unsplash.com/photo-1533158326339-7f3cf2404354?auto=format&fit=crop&w=400&q=80' },
  { word: 'Sword', category: 'Weapon', image: 'https://images.unsplash.com/photo-1595590424283-b8f17842773f?auto=format&fit=crop&w=400&q=80' },
  { word: 'Shield', category: 'Armor', image: 'https://images.unsplash.com/photo-1618336753974-aae8e04506aa?auto=format&fit=crop&w=400&q=80' },
  { word: 'Throne', category: 'Royal Furniture', image: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=400&q=80' },
  { word: 'Potion', category: 'Alchemy', image: 'https://images.unsplash.com/photo-1514733670139-4d87a1941d55?auto=format&fit=crop&w=400&q=80' },
  { word: 'Chariot', category: 'Vehicle', image: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=400&q=80' }
];

const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getSanitizedRoom(room, targetPlayerId) {
  const isImpostor = (room.impostorId === targetPlayerId);
  const secretCard = isImpostor
    ? { role: 'IMPOSTOR' }
    : { role: 'DETECTIVE', word: room.secretWord, category: room.secretCategory, image: room.secretImage };

  return {
    roomId: room.roomId,
    hostId: room.hostId,
    state: room.state,
    currentRound: room.currentRound,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isHost: p.id === room.hostId,
      connected: p.connected
    })),
    activePlayer: room.activePlayerOrder.length > 0 ? room.players.find(p => p.id === room.activePlayerOrder[room.currentTurnIndex]) : null,
    clues: room.clues,
    secretCard: (room.state === 'CLUE_PHASE' || room.state === 'VOTING_PHASE') ? secretCard : null,
    votesCount: Object.keys(room.votes).length,
    totalVoters: room.players.length,
    gameOverData: room.gameOverData || null
  };
}

function broadcastRoomState(room) {
  room.players.forEach(p => {
    if (p.socketId) {
      io.to(p.socketId).emit('full_state_update', getSanitizedRoom(room, p.id));
    }
  });
}

function tallyVotesAndEndGame(room) {
  if (room.state === 'GAME_OVER') return;
  room.state = 'GAME_OVER';

  if (room.countdownInterval) {
    clearInterval(room.countdownInterval);
    room.countdownInterval = null;
  }

  const voteCounts = {};
  room.players.forEach(p => { voteCounts[p.id] = 0; });

  const detailedVotes = [];
  Object.keys(room.votes).forEach(voterId => {
    const vData = room.votes[voterId];
    const suspectId = vData.suspectId;
    if (voteCounts[suspectId] !== undefined) {
      voteCounts[suspectId]++;
    }
    const voter = room.players.find(p => p.id === voterId);
    const suspect = room.players.find(p => p.id === suspectId);
    detailedVotes.push({
      voterName: voter ? voter.name : 'Unknown',
      suspectName: suspect ? suspect.name : 'Unknown',
      reason: vData.reason || 'No clue analysis provided.'
    });
  });

  const impostor = room.players.find(p => p.id === room.impostorId);
  const impostorVotes = voteCounts[room.impostorId] || 0;

  let maxVotes = 0;
  Object.values(voteCounts).forEach(cnt => {
    if (cnt > maxVotes) maxVotes = cnt;
  });

  // Impostor is caught if they receive the highest vote total (including ties)
  const impostorCaught = (impostorVotes > 0 && impostorVotes === maxVotes);

  const winningPlayers = [];
  const DETECTIVE_POINTS = 100;
  const IMPOSTOR_POINTS = 150;

  if (impostorCaught) {
    // Tie / Shared points for ALL detectives who correctly identified the impostor
    const correctDetectives = room.players.filter(p => {
      const v = room.votes[p.id];
      return v && v.suspectId === room.impostorId;
    });

    const winners = correctDetectives.length > 0 ? correctDetectives : room.players.filter(p => p.id !== room.impostorId);

    winners.forEach(det => {
      det.points = (det.points || 0) + DETECTIVE_POINTS;
      det.lastPoints = DETECTIVE_POINTS;
      det.matches = (det.matches || 0) + 1;
      winningPlayers.push({
        id: det.id,
        name: det.name,
        avatar: Number(det.avatar !== undefined ? det.avatar : 0),
        points: DETECTIVE_POINTS
      });
    });
  } else {
    // Impostor survives or ties for survival
    if (impostor) {
      impostor.points = (impostor.points || 0) + IMPOSTOR_POINTS;
      impostor.lastPoints = IMPOSTOR_POINTS;
      impostor.matches = (impostor.matches || 0) + 1;
      winningPlayers.push({
        id: impostor.id,
        name: impostor.name,
        avatar: Number(impostor.avatar !== undefined ? impostor.avatar : 0),
        points: IMPOSTOR_POINTS
      });
    }
  }

  // Update persistent leaderboard
  winningPlayers.forEach(w => {
    const entry = globalLeaderboard.find(l => l.avatarIndex === w.avatar);
    if (entry) {
      entry.points += w.points;
      entry.lastPoints = w.points;
      entry.matches += 1;
    }
  });

  room.gameOverData = {
    impostorCaught,
    impostorName: impostor ? impostor.name : 'Unknown',
    secretWord: room.secretWord,
    secretCategory: room.secretCategory,
    detailedVotes,
    winningPlayers
  };

  broadcastRoomState(room);
  io.emit('leaderboard_update', globalLeaderboard);
}

function startCountdownPhase(room) {
  room.state = 'COUNTDOWN_PHASE';
  let counter = 10;
  io.to(room.roomId).emit('start_reveal_countdown', { count: counter });

  if (room.countdownInterval) clearInterval(room.countdownInterval);

  room.countdownInterval = setInterval(() => {
    counter--;
    if (counter >= 0) {
      io.to(room.roomId).emit('countdown_tick', { count: counter });
    }
    if (counter <= 0) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;
      tallyVotesAndEndGame(room);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  socket.on('get_leaderboard', () => {
    socket.emit('leaderboard_update', globalLeaderboard);
  });

  socket.on('reset_leaderboard_global', () => {
    globalLeaderboard.forEach(item => {
      item.points = 0;
      item.lastPoints = 0;
      item.matches = 0;
    });
    io.emit('leaderboard_update', globalLeaderboard);
  });

  socket.on('resume_session', ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!room) {
      return socket.emit('session_resume_failed');
    }
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      return socket.emit('session_resume_failed');
    }

    player.socketId = socket.id;
    player.connected = true;
    socket.join(roomId);
    socket.emit('session_resumed', getSanitizedRoom(room, playerId));
    broadcastRoomState(room);
  });

  socket.on('create_room', ({ playerName, avatar, playerId }) => {
    let roomId = generateRoomCode();
    while (rooms[roomId]) {
      roomId = generateRoomCode();
    }

    const validAvatar = Math.max(0, Math.min(7, parseInt(avatar, 10) || 0));

    const room = {
      roomId,
      hostId: playerId,
      state: 'LOBBY',
      players: [{
        id: playerId,
        socketId: socket.id,
        name: playerName.substring(0, 14),
        avatar: validAvatar,
        connected: true,
        points: 0,
        matches: 0
      }],
      currentRound: 1,
      impostorId: null,
      secretWord: '',
      secretCategory: '',
      secretImage: '',
      clues: [],
      votes: {},
      activePlayerOrder: [],
      currentTurnIndex: 0,
      countdownInterval: null,
      gameOverData: null
    };

    rooms[roomId] = room;
    socket.join(roomId);
    socket.emit('room_created', { roomId });
    broadcastRoomState(room);
  });

  socket.on('join_room', ({ roomId, playerName, avatar, playerId }) => {
    const code = (roomId || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) {
      return socket.emit('error_message', 'Chamber not found. Verify the 4-letter code.');
    }
    if (room.state !== 'LOBBY' && !room.players.some(p => p.id === playerId)) {
      return socket.emit('error_message', 'Match is currently in progress.');
    }

    const validAvatar = Math.max(0, Math.min(7, parseInt(avatar, 10) || 0));
    let player = room.players.find(p => p.id === playerId);

    if (player) {
      player.socketId = socket.id;
      player.name = playerName.substring(0, 14);
      player.avatar = validAvatar;
      player.connected = true;
    } else {
      if (room.players.length >= 8) {
        return socket.emit('error_message', 'Chamber is full (8 players maximum).');
      }
      player = {
        id: playerId,
        socketId: socket.id,
        name: playerName.substring(0, 14),
        avatar: validAvatar,
        connected: true,
        points: 0,
        matches: 0
      };
      room.players.push(player);
    }

    socket.join(code);
    socket.emit('room_joined', { roomId: code });
    broadcastRoomState(room);
  });

  socket.on('start_game', () => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.socketId === socket.id));
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || player.id !== room.hostId) {
      return socket.emit('error_message', 'Only the Chamber Host can initiate the game.');
    }

    const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    const impostorIndex = Math.floor(Math.random() * room.players.length);

    room.state = 'CLUE_PHASE';
    room.currentRound = 1;
    room.impostorId = room.players[impostorIndex].id;
    room.secretWord = topic.word;
    room.secretCategory = topic.category;
    room.secretImage = topic.image;
    room.clues = [];
    room.votes = {};
    room.gameOverData = null;

    room.activePlayerOrder = [...room.players].sort(() => Math.random() - 0.5).map(p => p.id);
    room.currentTurnIndex = 0;

    io.to(room.roomId).emit('match_started_sync');
    broadcastRoomState(room);
  });

  socket.on('submit_clue', ({ text }) => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.socketId === socket.id));
    if (!room || room.state !== 'CLUE_PHASE') return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    const currentExpectedId = room.activePlayerOrder[room.currentTurnIndex];
    if (player.id !== currentExpectedId) {
      return socket.emit('error_message', 'Wait for your turn to transmit a clue.');
    }

    room.clues.push({
      round: room.currentRound,
      playerId: player.id,
      playerName: player.name,
      text: text.substring(0, 120)
    });

    room.currentTurnIndex++;
    if (room.currentTurnIndex >= room.activePlayerOrder.length) {
      room.currentTurnIndex = 0;
      room.currentRound++;
      if (room.currentRound > 3) {
        room.state = 'VOTING_PHASE';
        broadcastRoomState(room);
        return;
      }
    }
    broadcastRoomState(room);
  });

  socket.on('end_clues_early', () => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.socketId === socket.id));
    if (!room || room.state !== 'CLUE_PHASE') return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || player.id !== room.hostId) {
      return socket.emit('error_message', 'Only the Host can conclude clues early.');
    }

    room.state = 'VOTING_PHASE';
    broadcastRoomState(room);
  });

  socket.on('submit_vote', ({ suspectId, reason }) => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.socketId === socket.id));
    if (!room || room.state !== 'VOTING_PHASE') return;
    const voter = room.players.find(p => p.socketId === socket.id);
    if (!voter) return;

    room.votes[voter.id] = {
      suspectId,
      reason: (reason || '').substring(0, 180)
    };

    io.to(room.roomId).emit('vote_progress', {
      votesCount: Object.keys(room.votes).length,
      totalVoters: room.players.length
    });

    if (Object.keys(room.votes).length >= room.players.length) {
      startCountdownPhase(room);
    }
  });

  socket.on('force_reveal_now', () => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.socketId === socket.id));
    if (!room || (room.state !== 'COUNTDOWN_PHASE' && room.state !== 'VOTING_PHASE')) return;
    tallyVotesAndEndGame(room);
  });

  socket.on('play_again', () => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.socketId === socket.id));
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || player.id !== room.hostId) {
      return socket.emit('error_message', 'Only the Host can restart the match.');
    }

    room.state = 'LOBBY';
    room.currentRound = 1;
    room.clues = [];
    room.votes = {};
    room.gameOverData = null;
    if (room.countdownInterval) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;
    }
    broadcastRoomState(room);
  });

  socket.on('disconnect', () => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.socketId === socket.id));
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    player.connected = false;
    broadcastRoomState(room);

    setTimeout(() => {
      if (!player.connected) {
        room.players = room.players.filter(p => p.id !== player.id);
        if (room.players.length === 0) {
          if (room.countdownInterval) clearInterval(room.countdownInterval);
          delete rooms[room.roomId];
        } else if (room.hostId === player.id) {
          room.hostId = room.players[0].id;
          broadcastRoomState(room);
        }
      }
    }, 30000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
