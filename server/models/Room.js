import mongoose from "mongoose";

// ── Sub-schemas ──────────────────────────────────────────────

const ParticipantSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    username: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: ["host", "moderator", "participant"],
      default: "participant",
    },
    socketId: { type: String, default: null },
    connected: { type: Boolean, default: false },
    joinedAt: { type: Number, default: () => Date.now() },
  },
  { _id: false }
);

const PlaybackSchema = new mongoose.Schema(
  {
    videoId: { type: String, default: "" },
    playbackState: {
      type: String,
      enum: ["playing", "paused"],
      default: "paused",
    },
    currentTime: { type: Number, default: 0 },
    lastUpdated: { type: Number, default: () => Date.now() },
  },
  { _id: false }
);

const MessageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    senderRole: { type: String, required: true },
    text: { type: String, required: true },
    timestamp: { type: Number, default: () => Date.now() },
  },
  { _id: false }
);

const ApprovalRequestSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    participantId: { type: String, required: true },
    username: { type: String, required: true },
    action: {
      type: String,
      enum: ["play", "pause", "seek", "change_video"],
      required: true,
    },
    videoId: { type: String, default: null },
    currentTime: { type: Number, default: null },
    note: { type: String, default: "" },
    createdAt: { type: Number, default: () => Date.now() },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  { _id: false }
);

// ── Root Room schema ─────────────────────────────────────────

const RoomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true, index: true },
    hostId: { type: String, required: true },
    participants: { type: [ParticipantSchema], default: [] },
    kickedParticipantIds: { type: [String], default: [] },
    playback: { type: PlaybackSchema, default: () => ({}) },
    requests: { type: [ApprovalRequestSchema], default: [] },
    messages: { type: [MessageSchema], default: [] },
    // TTL: auto-delete empty rooms after 24 hours of inactivity
    lastActivityAt: { type: Date, default: Date.now, expires: "24h" },
  },
  { timestamps: true }
);

// Keep messages capped at 100 on save
RoomSchema.pre("save", function () {
  if (this.messages.length > 100) {
    this.messages = this.messages.slice(-100);
  }
});

export const Room = mongoose.model("Room", RoomSchema);

