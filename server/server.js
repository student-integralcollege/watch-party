import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { randomUUID } from "crypto";
import "dotenv/config";

import { connectDB } from "./db.js";
import { Room } from "./models/Room.js";

const app = express();
const httpServer = createServer(app);

const PORT = process.env.PORT || 5000;
const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((o) => o.trim())
  : [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ];

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true); // Dev-friendly fallback
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentPlaybackTime(room) {
  if (room.playback.playbackState === "playing") {
    const elapsedSeconds = (Date.now() - room.playback.lastUpdated) / 1000;
    return Math.max(0, room.playback.currentTime + elapsedSeconds);
  }
  return Math.max(0, room.playback.currentTime);
}

function getSanitizedRoom(room) {
  return {
    roomId: room.roomId,
    hostId: room.hostId,
    participants: room.participants.map((p) => ({
      id: p.id,
      username: p.username,
      role: p.role,
      connected: p.connected,
      joinedAt: p.joinedAt,
    })),
    videoId: room.playback.videoId,
    playbackState: room.playback.playbackState,
    currentTime: getCurrentPlaybackTime(room),
    requests: room.requests,
    messages: room.messages.slice(-60),
  };
}

async function broadcastRoom(roomId) {
  const room = await Room.findOne({ roomId });
  if (room) {
    io.to(roomId).emit("room_updated", getSanitizedRoom(room));
  }
}

async function handleHostDeparture(room) {
  const currentHost = room.participants.find(
    (p) => p.id === room.hostId && p.connected
  );
  if (currentHost) return;

  const candidates = room.participants.filter(
    (p) => p.id !== room.hostId && p.connected
  );
  const fallbackCandidates = room.participants.filter(
    (p) => p.id !== room.hostId
  );

  const nextHost =
    candidates.find((p) => p.role === "moderator") ||
    candidates[0] ||
    fallbackCandidates.find((p) => p.role === "moderator") ||
    fallbackCandidates[0];

  if (nextHost) {
    nextHost.role = "host";
    room.hostId = nextHost.id;
    console.log(
      `[Room ${room.roomId}] Host reassigned to ${nextHost.username} (${nextHost.id})`
    );

    const systemMsg = {
      id: randomUUID(),
      senderId: "system",
      senderName: "System",
      senderRole: "system",
      text: `${nextHost.username} is now the host.`,
      timestamp: Date.now(),
    };
    room.messages.push(systemMsg);
    io.to(room.roomId).emit("new_message", systemMsg);
  }
}

async function removeParticipantFromRoom(room, participantId, reason = "left") {
  const participant = room.participants.find((p) => p.id === participantId);
  if (!participant) return;

  room.participants = room.participants.filter((p) => p.id !== participantId);
  room.requests = room.requests.filter((r) => r.participantId !== participantId);
  console.log(`[Room ${room.roomId}] ${participant.username} ${reason}`);

  if (room.participants.length === 0) {
    // Keep in DB for TTL cleanup (24h), just log it
    console.log(`[Room ${room.roomId}] Empty room — will expire automatically via TTL.`);
    await room.save();
    return;
  }

  if (room.hostId === participantId) {
    await handleHostDeparture(room);
  }

  if (reason !== "kicked") {
    const systemMsg = {
      id: randomUUID(),
      senderId: "system",
      senderName: "System",
      senderRole: "system",
      text: `${participant.username} left the room.`,
      timestamp: Date.now(),
    };
    room.messages.push(systemMsg);
    io.to(room.roomId).emit("new_message", systemMsg);
  }

  room.lastActivityAt = new Date();
  await room.save();
  await broadcastRoom(room.roomId);
}

// ─── REST: Health Check ───────────────────────────────────────────────────────

app.get("/", async (req, res, next) => {
  try {
    const count = await Room.countDocuments();
    res.json({ status: "ok", service: "WatchParty Backend", roomsCount: count });
  } catch (err) { next(err); }
});

// ─── REST: CREATE ROOM ────────────────────────────────────────────────────────

// Express 5 automatically forwards async errors — no try/catch needed.
app.post("/api/rooms", async (req, res) => {
  const username = req.body.username?.trim();
  if (!username) {
    return res.status(400).json({ success: false, message: "Username is required" });
  }

  let roomId;
  do {
    roomId = randomUUID().replace(/-/g, "").slice(0, 8).toLowerCase();
  } while (await Room.exists({ roomId }));

  const host = {
    id: randomUUID(),
    username,
    role: "host",
    socketId: null,
    connected: false,
    joinedAt: Date.now(),
  };

  const room = new Room({
    roomId,
    hostId: host.id,
    participants: [host],
    kickedParticipantIds: [],
    playback: {
      videoId: "",
      playbackState: "paused",
      currentTime: 0,
      lastUpdated: Date.now(),
    },
    requests: [],
    messages: [
      {
        id: randomUUID(),
        senderId: "system",
        senderName: "System",
        senderRole: "system",
        text: `Room created by ${username}. Welcome to WatchParty!`,
        timestamp: Date.now(),
      },
    ],
  });

  await room.save();
  console.log(`[Room Created] Room ID: ${roomId} by ${username}`);

  res.status(201).json({
    success: true,
    room: getSanitizedRoom(room),
    participant: host,
  });
});

// ─── REST: JOIN ROOM ──────────────────────────────────────────────────────────

app.post("/api/rooms/:roomId/join", async (req, res) => {
  const roomId = req.params.roomId?.toLowerCase().trim();
  const username = req.body.username?.trim();
  const existingParticipantId = req.body.participantId?.trim();

  if (!username) {
    return res.status(400).json({ success: false, message: "Username is required" });
  }

  const room = await Room.findOne({ roomId });
  if (!room) {
    return res.status(404).json({
      success: false,
      message: "Room not found. Please check the code and try again.",
    });
  }

  if (existingParticipantId && room.kickedParticipantIds.includes(existingParticipantId)) {
    return res.status(403).json({
      success: false,
      message: "You have been removed from this room by the host.",
    });
  }

  let participant = null;
  if (existingParticipantId) {
    participant = room.participants.find((p) => p.id === existingParticipantId);
    if (participant) participant.username = username;
  }

  if (!participant) {
    participant = {
      id: randomUUID(),
      username,
      role: room.participants.length === 0 ? "host" : "participant",
      socketId: null,
      connected: false,
      joinedAt: Date.now(),
    };
    room.participants.push(participant);
    console.log(`[Join Room] ${username} joined room ${roomId}`);

    const systemMsg = {
      id: randomUUID(),
      senderId: "system",
      senderName: "System",
      senderRole: "system",
      text: `${username} joined the party.`,
      timestamp: Date.now(),
    };
    room.messages.push(systemMsg);
    io.to(roomId).emit("new_message", systemMsg);
  }

  room.lastActivityAt = new Date();
  await room.save();

  res.status(200).json({ success: true, room: getSanitizedRoom(room), participant });
});

// ─── REST: GET ROOM INFO ──────────────────────────────────────────────────────

app.get("/api/rooms/:roomId", async (req, res) => {
  const roomId = req.params.roomId?.toLowerCase().trim();
  const room = await Room.findOne({ roomId });
  if (!room) {
    return res.status(404).json({ success: false, message: "Room not found" });
  }
  res.json({ success: true, room: getSanitizedRoom(room) });
});

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`[Socket Connected] Socket ID: ${socket.id}`);

  // Socket.IO does not handle rejected promises returned by async listeners.
  // A transient MongoDB/network failure in any handler would otherwise crash Node.
  const originalOn = socket.on.bind(socket);
  socket.on = (eventName, listener, ...args) => {
    if (listener?.constructor?.name === "AsyncFunction") {
      const asyncListener = listener;
      listener = (...listenerArgs) => {
        Promise.resolve()
          .then(() => asyncListener(...listenerArgs))
          .catch((err) => {
            console.error(`[Socket ${eventName}] ${err?.stack || err}`);
            if (eventName !== "disconnect" && socket.connected) {
              socket.emit("room_error", "A temporary server or database error occurred. Please try again.");
            }
          });
      };
    }
    return originalOn(eventName, listener, ...args);
  };

  // 1. JOIN ROOM
  socket.on("join_room", async ({ roomId, participantId, username }) => {
    roomId = roomId?.toLowerCase().trim();
    const room = await Room.findOne({ roomId });

    if (!room) {
      socket.emit("room_error", "Room not found. Please verify your room code.");
      return;
    }

    if (room.kickedParticipantIds.includes(participantId)) {
      socket.emit("kicked", "You were removed from this room by the host.");
      socket.disconnect();
      return;
    }

    let participant = room.participants.find((p) => p.id === participantId);

    if (!participant) {
      const isHostFallback =
        room.participants.length === 0 || room.hostId === participantId;
      participant = {
        id: participantId || randomUUID(),
        username: username || "Guest",
        role: isHostFallback ? "host" : "participant",
        socketId: socket.id,
        connected: true,
        joinedAt: Date.now(),
      };
      room.participants.push(participant);
      if (isHostFallback) room.hostId = participant.id;
      console.log(
        `[Room ${roomId}] Restored participant ${participant.username} (${participant.role})`
      );
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.participantId = participant.id;

    participant.socketId = socket.id;
    participant.connected = true;
    room.lastActivityAt = new Date();
    await room.save();

    socket.emit("playback_sync", {
      videoId: room.playback.videoId,
      playbackState: room.playback.playbackState,
      currentTime: getCurrentPlaybackTime(room),
      action: "sync",
      serverTimestamp: Date.now(),
    });

    socket.emit("room_joined", getSanitizedRoom(room));
    await broadcastRoom(roomId);

    console.log(
      `[Room ${roomId}] ${participant.username} (${participant.role}) active on socket ${socket.id}`
    );
  });

  // 2. PLAY (Host / Moderator only)
  socket.on("play", async ({ currentTime } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return socket.emit("room_error", "You are not connected to an active room.");

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    if (participant.role !== "host" && participant.role !== "moderator") {
      return socket.emit("room_error", "Only the host or moderators can directly play. Use 'Request Play'.");
    }

    const time =
      typeof currentTime === "number" && Number.isFinite(currentTime) && currentTime >= 0
        ? currentTime
        : getCurrentPlaybackTime(room);

    room.playback.currentTime = time;
    room.playback.playbackState = "playing";
    room.playback.lastUpdated = Date.now();
    room.lastActivityAt = new Date();
    await room.save();

    io.to(roomId).emit("playback_sync", {
      videoId: room.playback.videoId,
      playbackState: "playing",
      currentTime: time,
      action: "play",
      serverTimestamp: Date.now(),
    });
    await broadcastRoom(roomId);
  });

  // 3. PAUSE (Host / Moderator only)
  socket.on("pause", async ({ currentTime } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return socket.emit("room_error", "You are not connected to an active room.");

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    if (participant.role !== "host" && participant.role !== "moderator") {
      return socket.emit("room_error", "Only the host or moderators can directly pause. Use 'Request Pause'.");
    }

    const time =
      typeof currentTime === "number" && Number.isFinite(currentTime) && currentTime >= 0
        ? currentTime
        : getCurrentPlaybackTime(room);

    room.playback.currentTime = time;
    room.playback.playbackState = "paused";
    room.playback.lastUpdated = Date.now();
    room.lastActivityAt = new Date();
    await room.save();

    io.to(roomId).emit("playback_sync", {
      videoId: room.playback.videoId,
      playbackState: "paused",
      currentTime: time,
      action: "pause",
      serverTimestamp: Date.now(),
    });
    await broadcastRoom(roomId);
  });

  // 4. SEEK (Host / Moderator only)
  socket.on("seek", async ({ currentTime } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return socket.emit("room_error", "You are not connected to an active room.");

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    if (participant.role !== "host" && participant.role !== "moderator") {
      return socket.emit("room_error", "Only the host or moderators can directly seek. Use 'Request Seek'.");
    }

    const time = Number(currentTime);
    if (!Number.isFinite(time) || time < 0) return;

    room.playback.currentTime = time;
    room.playback.lastUpdated = Date.now();
    room.lastActivityAt = new Date();
    await room.save();

    io.to(roomId).emit("playback_sync", {
      videoId: room.playback.videoId,
      playbackState: room.playback.playbackState,
      currentTime: time,
      action: "seek",
      serverTimestamp: Date.now(),
    });
    await broadcastRoom(roomId);
  });

  // 5. CHANGE VIDEO (Host / Moderator only)
  socket.on("change_video", async ({ videoId } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return socket.emit("room_error", "You are not connected to an active room.");

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    if (participant.role !== "host" && participant.role !== "moderator") {
      return socket.emit("room_error", "Only the host or moderators can directly change videos. Use 'Request Video Change'.");
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || "")) {
      return socket.emit("room_error", "Invalid YouTube video ID format.");
    }

    room.playback.videoId = videoId;
    room.playback.currentTime = 0;
    room.playback.playbackState = "paused";
    room.playback.lastUpdated = Date.now();
    room.lastActivityAt = new Date();

    console.log(`[Room ${roomId}] Video changed to ${videoId} by ${participant.username}`);

    const msg = {
      id: randomUUID(),
      senderId: "system",
      senderName: "System",
      senderRole: "system",
      text: `${participant.username} loaded a new video.`,
      timestamp: Date.now(),
    };
    room.messages.push(msg);
    await room.save();

    io.to(roomId).emit("playback_sync", {
      videoId,
      playbackState: "paused",
      currentTime: 0,
      action: "change_video",
      serverTimestamp: Date.now(),
    });
    io.to(roomId).emit("new_message", msg);
    await broadcastRoom(roomId);
  });

  // 6. REQUEST ACTION (Participant → asks host/moderator)
  socket.on("request_action", async ({ action, videoId, currentTime, note } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return socket.emit("room_error", "You are not connected to an active room.");

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    const validActions = ["play", "pause", "seek", "change_video"];
    if (!validActions.includes(action)) {
      return socket.emit("room_error", "Invalid action request.");
    }

    if (action === "change_video" && !/^[a-zA-Z0-9_-]{11}$/.test(videoId || "")) {
      return socket.emit("room_error", "A valid 11-character YouTube video ID is required.");
    }

    if (action === "seek" && (typeof currentTime !== "number" || currentTime < 0)) {
      return socket.emit("room_error", "A valid seek timestamp is required.");
    }

    const existing = room.requests.find(
      (r) => r.participantId === participantId && r.action === action && r.status === "pending"
    );
    if (existing) {
      return socket.emit("room_error", `You already have a pending '${action}' request.`);
    }

    const request = {
      id: randomUUID(),
      participantId,
      username: participant.username,
      action,
      videoId: videoId || null,
      currentTime: typeof currentTime === "number" ? Math.max(0, currentTime) : null,
      note: note ? String(note).slice(0, 100).trim() : "",
      createdAt: Date.now(),
      status: "pending",
    };

    room.requests.push(request);
    room.lastActivityAt = new Date();
    await room.save();

    console.log(`[Room ${roomId}] Request added by ${participant.username}: ${action}`);
    io.to(roomId).emit("new_approval_request", request);
    await broadcastRoom(roomId);
    socket.emit("request_submitted", { requestId: request.id, action });
  });

  // 7. APPROVE REQUEST (Host / Moderator only)
  socket.on("approve_request", async ({ requestId } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return;

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    if (participant.role !== "host" && participant.role !== "moderator") {
      return socket.emit("room_error", "Unauthorized: only hosts and moderators can approve requests.");
    }

    const requestIndex = room.requests.findIndex(
      (r) => r.id === requestId && r.status === "pending"
    );
    if (requestIndex === -1) {
      return socket.emit("room_error", "Request not found or already handled.");
    }

    const request = room.requests[requestIndex];
    request.status = "approved";

    if (request.action === "play") {
      const time = typeof request.currentTime === "number" ? request.currentTime : getCurrentPlaybackTime(room);
      room.playback.currentTime = time;
      room.playback.playbackState = "playing";
      room.playback.lastUpdated = Date.now();
      io.to(roomId).emit("playback_sync", { videoId: room.playback.videoId, playbackState: "playing", currentTime: time, action: "play", serverTimestamp: Date.now() });
    } else if (request.action === "pause") {
      const time = typeof request.currentTime === "number" ? request.currentTime : getCurrentPlaybackTime(room);
      room.playback.currentTime = time;
      room.playback.playbackState = "paused";
      room.playback.lastUpdated = Date.now();
      io.to(roomId).emit("playback_sync", { videoId: room.playback.videoId, playbackState: "paused", currentTime: time, action: "pause", serverTimestamp: Date.now() });
    } else if (request.action === "seek") {
      const time = Math.max(0, Number(request.currentTime) || 0);
      room.playback.currentTime = time;
      room.playback.lastUpdated = Date.now();
      io.to(roomId).emit("playback_sync", { videoId: room.playback.videoId, playbackState: room.playback.playbackState, currentTime: time, action: "seek", serverTimestamp: Date.now() });
    } else if (request.action === "change_video") {
      room.playback.videoId = request.videoId;
      room.playback.currentTime = 0;
      room.playback.playbackState = "paused";
      room.playback.lastUpdated = Date.now();
      io.to(roomId).emit("playback_sync", { videoId: request.videoId, playbackState: "paused", currentTime: 0, action: "change_video", serverTimestamp: Date.now() });
    }

    room.requests.splice(requestIndex, 1);
    room.lastActivityAt = new Date();

    const systemMsg = {
      id: randomUUID(),
      senderId: "system",
      senderName: "System",
      senderRole: "system",
      text: `${participant.username} approved ${request.username}'s '${request.action}' request.`,
      timestamp: Date.now(),
    };
    room.messages.push(systemMsg);
    await room.save();

    io.to(roomId).emit("request_handled", {
      requestId: request.id,
      participantId: request.participantId,
      username: request.username,
      action: request.action,
      status: "approved",
      handledBy: participant.username,
    });
    io.to(roomId).emit("new_message", systemMsg);
    await broadcastRoom(roomId);
  });

  // 8. REJECT REQUEST (Host / Moderator only)
  socket.on("reject_request", async ({ requestId } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return;

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    if (participant.role !== "host" && participant.role !== "moderator") {
      return socket.emit("room_error", "Unauthorized: only hosts and moderators can reject requests.");
    }

    const requestIndex = room.requests.findIndex(
      (r) => r.id === requestId && r.status === "pending"
    );
    if (requestIndex === -1) {
      return socket.emit("room_error", "Request not found or already handled.");
    }

    const request = room.requests[requestIndex];
    room.requests.splice(requestIndex, 1);
    room.lastActivityAt = new Date();
    await room.save();

    io.to(roomId).emit("request_handled", {
      requestId: request.id,
      participantId: request.participantId,
      username: request.username,
      action: request.action,
      status: "rejected",
      handledBy: participant.username,
    });
    await broadcastRoom(roomId);
  });

  // 9. PROMOTE TO MODERATOR (Host only)
  socket.on("promote_moderator", async ({ targetParticipantId } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return;

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    if (participant.role !== "host") {
      return socket.emit("room_error", "Only the host can assign moderator roles.");
    }

    const target = room.participants.find((p) => p.id === targetParticipantId);
    if (!target) return socket.emit("room_error", "Participant not found.");
    if (target.role === "host") return socket.emit("room_error", "Cannot change host role.");

    target.role = "moderator";
    room.lastActivityAt = new Date();

    const systemMsg = {
      id: randomUUID(),
      senderId: "system",
      senderName: "System",
      senderRole: "system",
      text: `${target.username} was promoted to Moderator by ${participant.username}.`,
      timestamp: Date.now(),
    };
    room.messages.push(systemMsg);
    await room.save();

    io.to(roomId).emit("new_message", systemMsg);
    await broadcastRoom(roomId);
  });

  // 10. DEMOTE TO PARTICIPANT (Host only)
  socket.on("demote_moderator", async ({ targetParticipantId } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return;

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    if (participant.role !== "host") {
      return socket.emit("room_error", "Only the host can demote moderators.");
    }

    const target = room.participants.find((p) => p.id === targetParticipantId);
    if (!target) return socket.emit("room_error", "Participant not found.");
    if (target.role === "host") return socket.emit("room_error", "Cannot demote host.");

    target.role = "participant";
    room.lastActivityAt = new Date();

    const systemMsg = {
      id: randomUUID(),
      senderId: "system",
      senderName: "System",
      senderRole: "system",
      text: `${target.username} was demoted to Participant by ${participant.username}.`,
      timestamp: Date.now(),
    };
    room.messages.push(systemMsg);
    await room.save();

    io.to(roomId).emit("new_message", systemMsg);
    await broadcastRoom(roomId);
  });

  // 11. KICK PARTICIPANT (Host only)
  socket.on("kick_participant", async ({ targetParticipantId } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return;

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    if (participant.role !== "host") {
      return socket.emit("room_error", "Only the host can remove participants.");
    }
    if (targetParticipantId === participantId) {
      return socket.emit("room_error", "The host cannot remove themselves. Transfer host role or leave room instead.");
    }

    const target = room.participants.find((p) => p.id === targetParticipantId);
    if (!target) return socket.emit("room_error", "Participant not found.");

    room.kickedParticipantIds.push(targetParticipantId);

    if (target.socketId) {
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit("kicked", "You were removed from this room by the host.");
        targetSocket.leave(roomId);
        targetSocket.data.roomId = null;
        targetSocket.data.participantId = null;
      }
    }

    const removedUsername = target.username;
    await removeParticipantFromRoom(room, targetParticipantId, "kicked");

    const systemMsg = {
      id: randomUUID(),
      senderId: "system",
      senderName: "System",
      senderRole: "system",
      text: `${removedUsername} was removed from the party by the host.`,
      timestamp: Date.now(),
    };
    // Reload room since removeParticipantFromRoom already saved it
    const updatedRoom = await Room.findOne({ roomId });
    if (updatedRoom) {
      updatedRoom.messages.push(systemMsg);
      await updatedRoom.save();
    }
    io.to(roomId).emit("new_message", systemMsg);
    await broadcastRoom(roomId);
  });

  // 12. TRANSFER HOST (Host only)
  socket.on("transfer_host", async ({ targetParticipantId } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return;

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    if (participant.role !== "host") {
      return socket.emit("room_error", "Only the host can transfer host ownership.");
    }

    const target = room.participants.find((p) => p.id === targetParticipantId);
    if (!target) return socket.emit("room_error", "Participant not found.");

    participant.role = "moderator";
    target.role = "host";
    room.hostId = target.id;
    room.lastActivityAt = new Date();

    const systemMsg = {
      id: randomUUID(),
      senderId: "system",
      senderName: "System",
      senderRole: "system",
      text: `${participant.username} transferred host ownership to ${target.username}.`,
      timestamp: Date.now(),
    };
    room.messages.push(systemMsg);
    await room.save();

    io.to(roomId).emit("new_message", systemMsg);
    await broadcastRoom(roomId);
  });

  // 13. SEND CHAT MESSAGE
  socket.on("send_message", async ({ text } = {}) => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) {
      console.warn(`[send_message] Socket ${socket.id} not associated with active room`);
      return socket.emit("room_error", "Cannot send message: Not connected to an active room. Try rejoining.");
    }

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    const trimmed = String(text || "").trim();
    if (!trimmed) return;
    if (trimmed.length > 500) {
      return socket.emit("room_error", "Message cannot exceed 500 characters.");
    }

    const msg = {
      id: randomUUID(),
      senderId: participant.id,
      senderName: participant.username,
      senderRole: participant.role,
      text: trimmed,
      timestamp: Date.now(),
    };

    room.messages.push(msg);
    room.lastActivityAt = new Date();
    await room.save();

    console.log(`[Room ${roomId} Chat] ${participant.username}: ${trimmed}`);
    io.to(roomId).emit("new_message", msg);
  });

  // 14. LEAVE ROOM
  socket.on("leave_room", async () => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return;

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    socket.leave(roomId);
    socket.data.roomId = null;
    socket.data.participantId = null;

    await removeParticipantFromRoom(room, participant.id, "left");
  });

  // 15. DISCONNECT
  socket.on("disconnect", async () => {
    const { roomId, participantId } = socket.data || {};
    if (!roomId) return;

    const room = await Room.findOne({ roomId });
    if (!room) return;
    const participant = room.participants.find((p) => p.id === participantId);
    if (!participant) return;

    participant.connected = false;
    participant.socketId = null;
    await room.save();

    // Grace period for reconnection (tab reload, network blip)
    setTimeout(() => {
      (async () => {
      const currentRoom = await Room.findOne({ roomId });
      if (!currentRoom) return;
      const p = currentRoom.participants.find((x) => x.id === participantId);
      if (p && !p.connected) {
        await removeParticipantFromRoom(currentRoom, participantId, "disconnected");
      }
      })().catch((err) => {
        console.error(`[Disconnect cleanup] ${err?.stack || err}`);
      });
    }, 20000);
  });
});


// ─── Global JSON Error Handler ────────────────────────────────────────────────
// 4-param signature required by Express to identify this as an error handler.
// Returns JSON so the client never sees an HTML 500 page.
// eslint-disable-next-line no-unused-vars
app.use(function (err, req, res, next) {
  console.error("[Server Error]", err.message || err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function start() {
  await connectDB();
  httpServer.listen(PORT, () => {
    console.log(`WatchParty server listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("[Startup] Server could not start:", err?.stack || err);
  process.exitCode = 1;
});
