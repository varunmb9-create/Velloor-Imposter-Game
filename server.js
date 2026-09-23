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

// Persistent global leaderboard across sessions
const globalLeaderboard = [];
for (let i = 0; i < 8; i++) {
  globalLeaderboard.push({
    avatarIndex: i,
    matches: 0,
    lastPoints: 0,
    points: 0
  });
}

// 200 Unique Categorized Topics Deck
const MASTER_WORD_LIST = [
  { word: 'Apple', category: 'Fruit' },
  { word: 'Orange', category: 'Fruit' },
  { word: 'Banana', category: 'Fruit' },
  { word: 'Mango', category: 'Fruit' },
  { word: 'Grapes', category: 'Fruit' },
  { word: 'Lemon', category: 'Fruit' },
  { word: 'Coconut', category: 'Fruit' },
  { word: 'Dog', category: 'Animal' },
  { word: 'Cat', category: 'Animal' },
  { word: 'Cow', category: 'Animal' },
  { word: 'Goat', category: 'Animal' },
  { word: 'Horse', category: 'Animal' },
  { word: 'Sheep', category: 'Animal' },
  { word: 'Rabbit', category: 'Animal' },
  { word: 'Car', category: 'Vehicle' },
  { word: 'Bus', category: 'Vehicle' },
  { word: 'Train', category: 'Vehicle' },
  { word: 'Bike', category: 'Vehicle' },
  { word: 'Taxi', category: 'Vehicle' },
  { word: 'Boat', category: 'Vehicle' },
  { word: 'Plane', category: 'Vehicle' },
  { word: 'Pizza', category: 'Food' },
  { word: 'Burger', category: 'Food' },
  { word: 'Cake', category: 'Food' },
  { word: 'Donut', category: 'Food' },
  { word: 'Chocolate', category: 'Sweet' },
  { word: 'Ice Cream', category: 'Sweet' },
  { word: 'Popcorn', category: 'Snack' },
  { word: 'Phone', category: 'Electronics' },
  { word: 'TV', category: 'Electronics' },
  { word: 'Radio', category: 'Electronics' },
  { word: 'Camera', category: 'Electronics' },
  { word: 'Laptop', category: 'Electronics' },
  { word: 'Watch', category: 'Accessory' },
  { word: 'Computer', category: 'Electronics' },
  { word: 'Bed', category: 'Furniture' },
  { word: 'Pillow', category: 'Bedroom' },
  { word: 'Blanket', category: 'Bedroom' },
  { word: 'Chair', category: 'Furniture' },
  { word: 'Table', category: 'Furniture' },
  { word: 'Sofa', category: 'Furniture' },
  { word: 'Door', category: 'Household' },
  { word: 'Pen', category: 'Stationery' },
  { word: 'Pencil', category: 'Stationery' },
  { word: 'Book', category: 'Reading' },
  { word: 'Bag', category: 'Accessory' },
  { word: 'Eraser', category: 'Stationery' },
  { word: 'Ruler', category: 'Stationery' },
  { word: 'Notebook', category: 'Stationery' },
  { word: 'Shirt', category: 'Clothing' },
  { word: 'Pants', category: 'Clothing' },
  { word: 'Shoes', category: 'Footwear' },
  { word: 'Socks', category: 'Clothing' },
  { word: 'Hat', category: 'Accessory' },
  { word: 'Jacket', category: 'Clothing' },
  { word: 'Belt', category: 'Accessory' },
  { word: 'Sun', category: 'Space / Nature' },
  { word: 'Moon', category: 'Space / Nature' },
  { word: 'Star', category: 'Space / Nature' },
  { word: 'Cloud', category: 'Weather' },
  { word: 'Rain', category: 'Weather' },
  { word: 'Wind', category: 'Weather' },
  { word: 'Fire', category: 'Element' },
  { word: 'Football', category: 'Sports' },
  { word: 'Cricket', category: 'Sports' },
  { word: 'Tennis', category: 'Sports' },
  { word: 'Basketball', category: 'Sports' },
  { word: 'Badminton', category: 'Sports' },
  { word: 'Volleyball', category: 'Sports' },
  { word: 'Hockey', category: 'Sports' },
  { word: 'School', category: 'Place' },
  { word: 'Home', category: 'Place' },
  { word: 'Shop', category: 'Place' },
  { word: 'Park', category: 'Outdoor' },
  { word: 'Beach', category: 'Nature' },
  { word: 'Hospital', category: 'Building' },
  { word: 'Hotel', category: 'Building' },
  { word: 'Doctor', category: 'Profession' },
  { word: 'Teacher', category: 'Profession' },
  { word: 'Driver', category: 'Profession' },
  { word: 'Cook', category: 'Profession' },
  { word: 'Police', category: 'Profession' },
  { word: 'Farmer', category: 'Profession' },
  { word: 'Pilot', category: 'Profession' },
  { word: 'Soap', category: 'Hygiene' },
  { word: 'Towel', category: 'Bathroom' },
  { word: 'Toothbrush', category: 'Hygiene' },
  { word: 'Mirror', category: 'Bathroom' },
  { word: 'Comb', category: 'Grooming' },
  { word: 'Shampoo', category: 'Hygiene' },
  { word: 'Bucket', category: 'Household' },
  { word: 'Fork', category: 'Kitchen' },
  { word: 'Spoon', category: 'Kitchen' },
  { word: 'Plate', category: 'Kitchen' },
  { word: 'Cup', category: 'Kitchen' },
  { word: 'Bowl', category: 'Kitchen' },
  { word: 'Knife', category: 'Kitchen' },
  { word: 'Glass', category: 'Kitchen' },
  { word: 'Tree', category: 'Nature' },
  { word: 'Flower', category: 'Nature' },
  { word: 'Grass', category: 'Nature' },
  { word: 'Leaf', category: 'Nature' },
  { word: 'Stone', category: 'Nature' },
  { word: 'Sand', category: 'Nature' },
  { word: 'Water', category: 'Element' },
  { word: 'Birthday', category: 'Celebration' },
  { word: 'Wedding', category: 'Celebration' },
  { word: 'Party', category: 'Event' },
  { word: 'Holiday', category: 'Travel' },
  { word: 'Picnic', category: 'Outdoor' },
  { word: 'Christmas', category: 'Festival' },
  { word: 'Festival', category: 'Culture' },
  { word: 'Pool', category: 'Recreation' },
  { word: 'Zoo', category: 'Place' },
  { word: 'Cinema', category: 'Entertainment' },
  { word: 'Mall', category: 'Shopping' },
  { word: 'Playground', category: 'Outdoor' },
  { word: 'Ball', category: 'Sports Item' },
  { word: 'Bat', category: 'Sports Item' },
  { word: 'Goal', category: 'Sports Item' },
  { word: 'Net', category: 'Sports Item' },
  { word: 'Cap', category: 'Accessory' },
  { word: 'Whistle', category: 'Item' },
  { word: 'House', category: 'Building' },
  { word: 'Restaurant', category: 'Dining' },
  { word: 'Bank', category: 'Institution' },
  { word: 'Sandwich', category: 'Food' },
  { word: 'Fries', category: 'Fast Food' },
  { word: 'Noodles', category: 'Food' }
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

// Draw a word that has not been picked in this room yet
function drawNextUniqueTopic(room) {
  if (!room.availableWords || room.availableWords.length === 0) {
    // Fresh clone & shuffle when exhausted
    room.availableWords = [...MASTER_WORD_LIST].sort(() => Math.random() - 0.5);
  }
  return room.availableWords.pop();
}

// Select an Impostor with no consecutive repeats
function selectUnbiasedImpostor(room) {
  let eligiblePlayers = room.players;
  if (room.players.length > 1 && room.lastImpostorId) {
    const candidates = room.players.filter(p => p.id !== room.lastImpostorId);
    if (candidates.length > 0) eligiblePlayers = candidates;
  }
  const chosen = eligiblePlayers[Math.floor(Math.random() * eligiblePlayers.length)];
  room.lastImpostorId = chosen.id;
  return chosen.id;
}

function getSanitizedRoom(room, targetPlayerId) {
  const isImpostor = (room.impostorId === targetPlayerId);
  const secretCard = isImpostor
    ? { role: 'IMPOSTOR' }
    : { role: 'DETECTIVE', word: room.secretWord, category: room.secretCategory };

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

// PRIZE POOL LOGIC: Fixed 100 Points Match Budget
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
      reason: vData.reason || 'No clue deduction given.'
    });
  });

  const impostor = room.players.find(p => p.id === room.impostorId);
  const impostorVotes = voteCounts[room.impostorId] || 0;

  let maxVotes = 0;
  Object.values(voteCounts).forEach(cnt => {
    if (cnt > maxVotes) maxVotes = cnt;
  });

  // Majority rule check
  const totalVotesCast = Object.keys(room.votes).length;
  const isStrictMajority = (impostorVotes > totalVotesCast / 2);
  const isPluralityWin = (impostorVotes > 0 && impostorVotes === maxVotes);
  const impostorCaught = isStrictMajority || isPluralityWin;

  const TOTAL_MATCH_POINTS = 100;
  const winningPlayers = [];

  // Detectives who voted for the true impostor
  const correctDetectives = room.players.filter(p => {
    const v = room.votes[p.id];
    return v && v.suspectId === room.impostorId && p.id !== room.impostorId;
  });

  if (impostorCaught) {
    // CITIZENS WIN: Impostor caught by majority
    // 100 points divided among detectives who successfully identified the impostor
    const winners = correctDetectives.length > 0 ? correctDetectives : room.players.filter(p => p.id !== room.impostorId);
    const pointsEach = Math.round(TOTAL_MATCH_POINTS / winners.length);

    winners.forEach(det => {
      det.points = (det.points || 0) + pointsEach;
      det.lastPoints = pointsEach;
      det.matches = (det.matches || 0) + 1;
      winningPlayers.push({
        id: det.id,
        name: det.name,
        avatar: Number(det.avatar !== undefined ? det.avatar : 0),
        points: pointsEach
      });
    });
  } else {
    // IMPOSTOR WINS: Majority failed to catch the impostor
    if (correctDetectives.length > 0) {
      // Impostor claims 70%, sharp detectives who voted impostor share 30%
      const impostorBounty = 70;
      const detectiveShare = Math.round(30 / correctDetectives.length);

      if (impostor) {
        impostor.points = (impostor.points || 0) + impostorBounty;
        impostor.lastPoints = impostorBounty;
        impostor.matches = (impostor.matches || 0) + 1;
        winningPlayers.push({
          id: impostor.id,
          name: impostor.name,
          avatar: Number(impostor.avatar !== undefined ? impostor.avatar : 0),
          points: impostorBounty
        });
      }

      correctDetectives.forEach(det => {
        det.points = (det.points || 0) + detectiveShare;
        det.lastPoints = detectiveShare;
        det.matches = (det.matches || 0) + 1;
        winningPlayers.push({
          id: det.id,
          name: det.name,
          avatar: Number(det.avatar !== undefined ? det.avatar : 0),
          points: detectiveShare
        });
      });
    } else {
      // Impostor totally fooled everyone: Full 100 points to Impostor
      if (impostor) {
        impostor.points = (impostor.points || 0) + TOTAL_MATCH_POINTS;
        impostor.lastPoints = TOTAL_MATCH_POINTS;
        impostor.matches = (impostor.matches || 0) + 1;
        winningPlayers.push({
          id: impostor.id,
          name: impostor.name,
          avatar: Number(impostor.avatar !== undefined ? impostor.avatar : 0),
          points: TOTAL_MATCH_POINTS
        });
      }
    }
  }

  // Update global leaderboard
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
    if (!room) return socket.emit('session_resume_failed');
    const player = room.players.find(p => p.id === playerId);
    if (!player) return socket.emit('session_resume_failed');

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
      lastImpostorId: null,
      impostorId: null,
      availableWords: [...MASTER_WORD_LIST].sort(() => Math.random() - 0.5),
      secretWord: '',
      secretCategory: '',
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

    const topic = drawNextUniqueTopic(room);
    room.impostorId = selectUnbiasedImpostor(room);

    room.state = 'CLUE_PHASE';
    room.currentRound = 1;
    room.secretWord = topic.word;
    room.secretCategory = topic.category;
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
