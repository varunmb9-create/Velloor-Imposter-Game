const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// LEADERBOARD (AVATAR, MATCHES, LAST MATCH PTS, GRAND TOTAL)
// -------------------------------------------------------------
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

function createFreshLeaderboard() {
  const board = [];
  for (let i = 0; i < 8; i++) {
    board.push({
      avatarIndex: i,
      matches: 0,
      lastPoints: 0,
      points: 0
    });
  }
  return board;
}

function initLeaderboard() {
  if (fs.existsSync(LEADERBOARD_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
      if (Array.isArray(data) && data.length === 8) {
        return data.map((d, i) => ({
          avatarIndex: i,
          matches: Number(d.matches) || 0,
          lastPoints: Number(d.lastPoints) || 0,
          points: Number(d.points) || 0
        }));
      }
    } catch (e) {}
  }
  const defaultBoard = createFreshLeaderboard();
  saveLeaderboard(defaultBoard);
  return defaultBoard;
}

function saveLeaderboard(board) {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(board, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving leaderboard', e);
  }
}

let avatarLeaderboard = initLeaderboard();

function loadAllDecks() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data) && data.length > 0) return data;
  } catch (err) {
    console.error('Error reading words.json');
  }
  return [
    { category: 'Landmarks', word: 'Taj Mahal', image: '' },
    { category: 'Vehicles', word: 'Helicopter', image: '' }
  ];
}

function secureShuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const masterDeck = loadAllDecks();
const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(crypto.randomInt(0, chars.length));
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
  socket.emit('leaderboard_update', avatarLeaderboard);

  socket.on('get_leaderboard', () => {
    socket.emit('leaderboard_update', avatarLeaderboard);
  });

  socket.on('reset_leaderboard_global', () => {
    avatarLeaderboard = createFreshLeaderboard();
    saveLeaderboard(avatarLeaderboard);
    io.emit('leaderboard_update', avatarLeaderboard);
  });

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
  });

  socket.on('create_room', ({ playerName, avatar, playerId }) => {
    const roomId = generateRoomCode();
    rooms[roomId] = {
      roomId,
      hostId: playerId,
      players: [{ id: playerId, socketId: socket.id, name: playerName, avatar: avatar || 0, role: null, connected: true }],
      deckPool: secureShuffle(masterDeck),
      state: 'LOBBY',
      currentCard: null,
      currentRound: 1,
      totalRounds: 3,
      turnIndex: 0,
      clues: [],
      votes: {},
      gameOverData: null,
      countdownTimer: null,
      openingTimer: null
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

  function executeStartMatch(room) {
    if (!room.deckPool || room.deckPool.length === 0) {
      room.deckPool = secureShuffle(masterDeck);
    }
    room.currentCard = room.deckPool.pop();

    // 100% UNPREDICTABLE CRYPTOGRAPHIC IMPOSTOR SELECTION
    const impostorIndex = crypto.randomInt(0, room.players.length);
    const chosenImpostor = room.players[impostorIndex];

    room.players.forEach(p => {
      p.role = (p.id === chosenImpostor.id) ? 'IMPOSTOR' : 'CITIZEN';
    });

    room.state = 'OPENING_RITUAL';
    io.to(room.roomId).emit('trigger_opening_ritual');

    if (room.openingTimer) clearTimeout(room.openingTimer);
    room.openingTimer = setTimeout(() => {
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
    }, 3000);
  }

  socket.on('start_game', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    if (room.hostId !== socket.playerId) return;
    if (room.players.length < 3) {
      return socket.emit('error_message', 'At least 3 players required.');
    }
    executeStartMatch(room);
  });

  socket.on('play_again', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    if (room.state !== 'GAME_OVER') return;
    if (room.players.length < 3) {
      return socket.emit('error_message', 'At least 3 players required.');
    }
    executeStartMatch(room);
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

  socket.on('end_clues_early', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.playerId) return;
    if (room.state !== 'CLUE_PHASE') return;

    room.state = 'VOTING_PHASE';
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
          const runnerUpPlayers = [];
          const remainingPlayers = [];

          if (impostorCaught) {
            room.players.forEach(p => {
              const myVote = room.votes[p.id];
              if (myVote && myVote.suspectId === impostor.id) {
                winningPlayers.push(p);
              } else if (p.id !== impostor.id) {
                runnerUpPlayers.push(p);
              } else {
                remainingPlayers.push(p);
              }
            });
          } else {
            winningPlayers.push(impostor);
            room.players.forEach(p => {
              if (p.id !== impostor.id) {
                const myVote = room.votes[p.id];
                if (myVote && myVote.suspectId === impostor.id) {
                  runnerUpPlayers.push(p);
                } else {
                  remainingPlayers.push(p);
                }
              }
            });
          }

          const playerPointsAwarded = {};
          const winShare = winningPlayers.length > 0 ? Math.round(100 / winningPlayers.length) : 100;
          winningPlayers.forEach(p => playerPointsAwarded[p.id] = winShare);

          const runnerShare = runnerUpPlayers.length > 0 ? Math.round(75 / runnerUpPlayers.length) : 75;
          runnerUpPlayers.forEach(p => playerPointsAwarded[p.id] = runnerShare);

          const rankPointTiers = [50, 30, 20, 10, 5, 0];
          remainingPlayers.sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));

          let tierIndex = 0;
          let i = 0;
          while (i < remainingPlayers.length) {
            const currentVotes = counts[remainingPlayers[i].id] || 0;
            const tiedGroup = [];
            while (i < remainingPlayers.length && (counts[remainingPlayers[i].id] || 0) === currentVotes) {
              tiedGroup.push(remainingPlayers[i]);
              i++;
            }

            let totalPointsToSplit = 0;
            for (let k = 0; k < tiedGroup.length; k++) {
              const currentTierPts = rankPointTiers[tierIndex + k] !== undefined ? rankPointTiers[tierIndex + k] : 0;
              totalPointsToSplit += currentTierPts;
            }

            const splitShare = Math.round(totalPointsToSplit / tiedGroup.length);
            tiedGroup.forEach(p => playerPointsAwarded[p.id] = splitShare);

            tierIndex += tiedGroup.length;
          }

          room.players.forEach(p => {
            const avIndex = p.avatar !== undefined ? p.avatar : 0;
            const stats = avatarLeaderboard[avIndex];
            if (stats) {
              const ptsThisMatch = playerPointsAwarded[p.id] || 0;
              stats.matches += 1;
              stats.lastPoints = ptsThisMatch;
              stats.points += ptsThisMatch;
            }
          });
          saveLeaderboard(avatarLeaderboard);
          io.emit('leaderboard_update', avatarLeaderboard);

          const formattedWinners = winningPlayers.map(w => ({
            id: w.id,
            name: w.name,
            avatar: w.avatar,
            points: playerPointsAwarded[w.id] || 0
          }));

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
            winningPlayers: formattedWinners,
            detailedVotes
          };

          room.players.forEach(p => {
            io.to(p.socketId).emit('full_state_update', getSanitizedRoom(room, p.id));
          });
        }
      }, 1000);
    }
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (!room) return;

    const p = room.players.find(x => x.id === socket.playerId);
    if (p) p.connected = false;

    const anyConnected = room.players.some(x => x.connected);
    if (!anyConnected) {
      if (room.countdownTimer) clearInterval(room.countdownTimer);
      if (room.openingTimer) clearTimeout(room.openingTimer);
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

// BIND TO BOTH 10000 AND 0.0.0.0 FOR RENDER'S PROXY ROUTER
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server online on port ${PORT}`);
});
