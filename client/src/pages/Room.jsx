import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import YouTubePlayer from "../components/YouTubePlayer";
import { SOCKET_URL } from "../utils/config";
import { extractVideoId } from "../utils/youtube";

function Room({ roomId, participant, initialRoom, onLeave }) {
  const socketRef = useRef(null);
  const chatBottomRef = useRef(null);

  const [room, setRoom] = useState(initialRoom);
  const [connected, setConnected] = useState(false);
  const [command, setCommand] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeTab, setActiveTab] = useState("chat"); // 'participants' | 'requests' | 'chat'
  const [chatInput, setChatInput] = useState("");
  const [toasts, setToasts] = useState([]);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [requestModalAction, setRequestModalAction] = useState(null); // 'seek' | 'change_video' | null
  const [requestSeekTime, setRequestSeekTime] = useState(0);

  // Toast notification helper
  function addToast(text, type = "info") {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }

  // Derive current participant's up-to-date role from room state
  const currentParticipant =
    room?.participants?.find((p) => p.id === participant.id) || participant;
  const isHost =
    room?.hostId === participant.id || currentParticipant.role === "host";
  const isModerator = currentParticipant.role === "moderator";
  const canControl = isHost || isModerator;

  // Socket Connection and Event Listeners
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      transports: ["polling", "websocket"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_room", {
        roomId,
        participantId: participant.id,
        username: participant.username,
      });
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.warn("Socket connection error:", err.message);
    });

    socket.on("room_joined", (syncedRoom) => {
      setRoom(syncedRoom);
    });

    socket.on("room_updated", (updatedRoom) => {
      setRoom(updatedRoom);
    });

    socket.on("playback_sync", (syncData) => {
      setCommand(syncData);
      setCurrentTime(syncData.currentTime || 0);

      setRoom((prev) =>
        prev
          ? {
              ...prev,
              videoId: syncData.videoId,
              playbackState: syncData.playbackState,
              currentTime: syncData.currentTime,
            }
          : prev
      );
    });

    socket.on("new_message", (msg) => {
      setRoom((prev) => {
        if (!prev) return prev;
        const exists = prev.messages?.some((m) => m.id === msg.id);
        if (exists) return prev;
        return {
          ...prev,
          messages: [...(prev.messages || []), msg],
        };
      });
    });

    socket.on("new_approval_request", (req) => {
      addToast(
        `New request: ${req.username} requested to ${req.action.replace("_", " ")}`,
        "info"
      );
    });

    socket.on("request_handled", (data) => {
      if (data.participantId === participant.id) {
        if (data.status === "approved") {
          addToast(
            `Your '${data.action.replace("_", " ")}' request was approved by ${data.handledBy}!`,
            "success"
          );
        } else {
          addToast(
            `Your '${data.action.replace("_", " ")}' request was rejected by ${data.handledBy}.`,
            "error"
          );
        }
      }
    });

    socket.on("request_submitted", (data) => {
      addToast(`Request for '${data.action.replace("_", " ")}' submitted to room host.`, "info");
    });

    socket.on("kicked", (reason) => {
      alert(reason || "You were removed from this room by the host.");
      onLeave();
    });

    socket.on("room_error", (message) => {
      addToast(message, "error");
    });

    return () => {
      // NOTE: Do NOT emit "leave_room" here!
      // In React StrictMode or hot-reloading, unmounts are temporary.
      // Explicit leave only happens when clicking "Leave Room".
      socket.disconnect();
    };
  }, [roomId, participant.id, participant.username]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeTab === "chat") {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [room?.messages, activeTab]);

  // Copy shareable invite link
  function handleCopyInviteLink() {
    const inviteUrl = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopiedLink(true);
      addToast("Invite link copied to clipboard!", "success");
      setTimeout(() => setCopiedLink(false), 2500);
    });
  }

  // Copy room code
  function handleCopyRoomCode() {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopiedCode(true);
      addToast("Room code copied to clipboard!", "success");
      setTimeout(() => setCopiedCode(false), 2500);
    });
  }

  // Explicit user leave
  function handleLeaveRoom() {
    socketRef.current?.emit("leave_room");
    onLeave();
  }

  // Handle Video Change
  function handleLoadVideo() {
    const trimmed = videoUrl.trim();
    if (!trimmed) {
      addToast("Please enter a YouTube video URL or ID.", "error");
      return;
    }

    const res = extractVideoId(trimmed);
    if (!res.valid) {
      addToast(res.error, "error");
      return;
    }

    if (!socketRef.current || !connected) {
      addToast("Connecting to room server... Please try in a moment.", "error");
      return;
    }

    if (canControl) {
      socketRef.current.emit("change_video", { videoId: res.videoId });
      setVideoUrl("");
    } else {
      // Participant requesting video change
      socketRef.current.emit("request_action", {
        action: "change_video",
        videoId: res.videoId,
      });
      setVideoUrl("");
      addToast("Video change request sent to host for approval.", "info");
    }
  }

  // Handle Play
  function handlePlayClick() {
    if (!socketRef.current || !connected) {
      addToast("Not connected to room server.", "error");
      return;
    }

    if (canControl) {
      socketRef.current.emit("play", { currentTime });
    } else {
      socketRef.current.emit("request_action", {
        action: "play",
        currentTime,
      });
    }
  }

  // Handle Pause
  function handlePauseClick() {
    if (!socketRef.current || !connected) {
      addToast("Not connected to room server.", "error");
      return;
    }

    if (canControl) {
      socketRef.current.emit("pause", { currentTime });
    } else {
      socketRef.current.emit("request_action", {
        action: "pause",
        currentTime,
      });
    }
  }

  // Handle Seek slider change
  function handleSeekChange(newTime) {
    const time = Number(newTime);
    setCurrentTime(time);

    if (canControl) {
      socketRef.current?.emit("seek", { currentTime: time });
    }
  }

  // Submit seek request for Participant
  function handleParticipantSeekRequest() {
    socketRef.current?.emit("request_action", {
      action: "seek",
      currentTime: Number(requestSeekTime),
    });
    setRequestModalAction(null);
  }

  // Approval Request Actions
  function handleApproveRequest(requestId) {
    socketRef.current?.emit("approve_request", { requestId });
  }

  function handleRejectRequest(requestId) {
    socketRef.current?.emit("reject_request", { requestId });
  }

  // Role Management Actions
  function handlePromote(targetId) {
    socketRef.current?.emit("promote_moderator", { targetParticipantId: targetId });
  }

  function handleDemote(targetId) {
    socketRef.current?.emit("demote_moderator", { targetParticipantId: targetId });
  }

  function handleKick(targetId, targetName) {
    if (window.confirm(`Are you sure you want to remove ${targetName} from the party?`)) {
      socketRef.current?.emit("kick_participant", { targetParticipantId: targetId });
    }
  }

  function handleTransferHost(targetId, targetName) {
    if (window.confirm(`Transfer host ownership to ${targetName}? You will become a moderator.`)) {
      socketRef.current?.emit("transfer_host", { targetParticipantId: targetId });
    }
  }

  // Chat Submission
  function handleSendMessage(e) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;

    if (!socketRef.current || !connected) {
      addToast("Not connected to room server.", "error");
      return;
    }

    socketRef.current.emit("send_message", { text });
    setChatInput("");
  }

  // Format seconds to mm:ss or hh:mm:ss
  function formatTime(seconds) {
    const total = Math.floor(seconds || 0);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  const isPlaying = room?.playbackState === "playing";
  const pendingRequestsCount = room?.requests?.length || 0;

  return (
    <div className="room-container">
      {/* HEADER */}
      <header className="room-header">
        <div className="room-brand">
          <h1>WatchParty</h1>

          <div
            className="room-code-tag"
            onClick={handleCopyRoomCode}
            style={{ cursor: "pointer" }}
            title="Click to copy room code"
          >
            <span>Room:</span>
            <strong>{roomId}</strong>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>
              {copiedCode ? "✓ Copied" : "📋"}
            </span>
          </div>

          <div className="status-pill">
            <span
              className={`status-dot ${
                connected ? "status-connected" : "status-connecting"
              }`}
            />
            <span>{connected ? "Connected" : "Connecting..."}</span>
          </div>
        </div>

        <div className="room-header-actions">
          <button className="btn-secondary" onClick={handleCopyInviteLink}>
            {copiedLink ? "✓ Link Copied!" : "🔗 Copy Invite Link"}
          </button>

          <button className="btn-danger" onClick={handleLeaveRoom}>
            Leave Room
          </button>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="room-grid">
        {/* LEFT / CENTER: VIDEO & PLAYBACK CONTROLS */}
        <section className="video-card">
          {/* YouTube Player */}
          <YouTubePlayer
            videoId={room?.videoId}
            command={command}
            canControl={canControl}
            onTimeUpdate={setCurrentTime}
            onDurationChange={setDuration}
          />

          {/* Video URL Input */}
          <div className="video-input-group">
            <input
              type="text"
              placeholder={
                canControl
                  ? "Paste YouTube video link (watch?v=, youtu.be/, shorts, embed)..."
                  : "Suggest a YouTube video link to request approval..."
              }
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLoadVideo()}
            />
            <button
              className="btn-primary"
              onClick={handleLoadVideo}
              disabled={!videoUrl.trim()}
            >
              {canControl ? "Load Video" : "Request Video"}
            </button>
          </div>

          {/* Authoritative Playback Controls */}
          <div className="controls-panel">
            <div className="controls-toolbar">
              <div className="playback-buttons">
                {canControl ? (
                  <>
                    <button
                      className={`btn-ctrl ${isPlaying ? "active" : ""}`}
                      onClick={handlePlayClick}
                      disabled={!room?.videoId}
                      title="Play video for everyone"
                    >
                      ▶ Play
                    </button>
                    <button
                      className={`btn-ctrl ${!isPlaying ? "active" : ""}`}
                      onClick={handlePauseClick}
                      disabled={!room?.videoId}
                      title="Pause video for everyone"
                    >
                      ⏸ Pause
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn-ctrl"
                      onClick={handlePlayClick}
                      disabled={!room?.videoId}
                      title="Request host to play"
                    >
                      Request Play
                    </button>
                    <button
                      className="btn-ctrl"
                      onClick={handlePauseClick}
                      disabled={!room?.videoId}
                      title="Request host to pause"
                    >
                      Request Pause
                    </button>
                    <button
                      className="btn-ctrl"
                      onClick={() => {
                        setRequestSeekTime(Math.floor(currentTime));
                        setRequestModalAction("seek");
                      }}
                      disabled={!room?.videoId}
                    >
                      Request Seek
                    </button>
                  </>
                )}
              </div>

              <div className="time-counter">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>

            {/* Seek Bar */}
            <div className="seek-container">
              <input
                type="range"
                className="seek-slider"
                min="0"
                max={duration > 0 ? duration : 100}
                step="1"
                value={currentTime}
                disabled={!canControl || !room?.videoId}
                onChange={(e) => handleSeekChange(e.target.value)}
                title={
                  canControl
                    ? "Seek playback"
                    : "Participants must use 'Request Seek' to jump time"
                }
              />
            </div>

            {/* Role Notice Banner */}
            <div
              className={`role-notice-banner ${
                isHost
                  ? "notice-host"
                  : isModerator
                  ? "notice-moderator"
                  : "notice-participant"
              }`}
            >
              {isHost && (
                <span>
                  👑 <strong>Host:</strong> You have full playback control, member moderation, and request approval.
                </span>
              )}
              {isModerator && (
                <span>
                  🛡️ <strong>Moderator:</strong> You can control playback and approve participant requests.
                </span>
              )}
              {!canControl && (
                <span>
                  👀 <strong>Participant:</strong> Playback is synchronized automatically. Click request buttons above to ask for controls.
                </span>
              )}
            </div>
          </div>
        </section>

        {/* RIGHT: SIDEBAR (Participants, Requests, Chat) */}
        <aside className="sidebar-panel">
          {/* TAB HEADERS */}
          <div className="sidebar-tab-header">
            <button
              className={`sidebar-tab-btn ${activeTab === "chat" ? "active" : ""}`}
              onClick={() => setActiveTab("chat")}
            >
              💬 Chat
            </button>

            <button
              className={`sidebar-tab-btn ${
                activeTab === "participants" ? "active" : ""
              }`}
              onClick={() => setActiveTab("participants")}
            >
              👥 People
              <span className="tab-badge">
                {room?.participants?.length || 0}
              </span>
            </button>

            <button
              className={`sidebar-tab-btn ${
                activeTab === "requests" ? "active" : ""
              }`}
              onClick={() => setActiveTab("requests")}
            >
              ⚡ Requests
              {pendingRequestsCount > 0 && (
                <span className="tab-badge badge-alert">
                  {pendingRequestsCount}
                </span>
              )}
            </button>
          </div>

          {/* TAB 1: CHAT */}
          {activeTab === "chat" && (
            <div className="sidebar-tab-content">
              <div className="chat-messages">
                {room?.messages?.map((msg) => {
                  const isYou = msg.senderId === participant.id;
                  const isSystem = msg.senderRole === "system";

                  if (isSystem) {
                    return (
                      <div key={msg.id} className="chat-system">
                        {msg.text}
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} className="chat-message">
                      <div className="chat-message-meta">
                        <span
                          className={`chat-sender-name ${
                            isYou ? "is-you" : ""
                          }`}
                        >
                          {msg.senderName} {isYou ? "(You)" : ""}
                        </span>
                        {msg.senderRole === "host" && (
                          <span className="role-badge host">Host</span>
                        )}
                        {msg.senderRole === "moderator" && (
                          <span className="role-badge moderator">Mod</span>
                        )}
                        <span className="chat-time">
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div
                        className={`chat-bubble ${isYou ? "bubble-you" : ""}`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatBottomRef} />
              </div>

              <form className="chat-input-form" onSubmit={handleSendMessage}>
                <input
                  type="text"
                  placeholder="Type a message..."
                  maxLength={500}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                />
                <button type="submit" disabled={!chatInput.trim()}>
                  Send
                </button>
              </form>
            </div>
          )}

          {/* TAB 2: PARTICIPANTS */}
          {activeTab === "participants" && (
            <div className="sidebar-tab-content">
              {room?.participants?.map((person) => {
                const isPersonYou = person.id === participant.id;
                const isPersonHost = person.role === "host";
                const isPersonMod = person.role === "moderator";

                return (
                  <div key={person.id} className="participant-item">
                    <div className="participant-header">
                      <div className="participant-info">
                        <div className="participant-avatar">
                          {person.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="participant-username">
                            {person.username}
                          </span>
                          {isPersonYou && (
                            <span className="participant-you">(You)</span>
                          )}
                        </div>
                      </div>

                      <span
                        className={`role-badge ${
                          isPersonHost
                            ? "host"
                            : isPersonMod
                            ? "moderator"
                            : "participant"
                        }`}
                      >
                        {isPersonHost ? "👑 Host" : isPersonMod ? "🛡️ Mod" : "Viewer"}
                      </span>
                    </div>

                    {/* Host Moderation Controls */}
                    {isHost && !isPersonYou && (
                      <div className="participant-actions">
                        {!isPersonMod && (
                          <button
                            className="btn-sm-action"
                            onClick={() => handlePromote(person.id)}
                            title="Promote to Moderator"
                          >
                            + Make Mod
                          </button>
                        )}
                        {isPersonMod && (
                          <button
                            className="btn-sm-action"
                            onClick={() => handleDemote(person.id)}
                            title="Demote to Participant"
                          >
                            - Demote
                          </button>
                        )}
                        <button
                          className="btn-sm-action"
                          onClick={() => handleTransferHost(person.id, person.username)}
                          title="Transfer room ownership"
                        >
                          Transfer Host
                        </button>
                        <button
                          className="btn-sm-action btn-sm-danger"
                          onClick={() => handleKick(person.id, person.username)}
                          title="Remove user from room"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 3: APPROVAL REQUESTS */}
          {activeTab === "requests" && (
            <div className="sidebar-tab-content">
              {room?.requests && room.requests.length > 0 ? (
                room.requests.map((req) => (
                  <div key={req.id} className="request-item">
                    <div className="request-item-header">
                      <span className="request-action-name">
                        {req.action.replace("_", " ")}
                      </span>
                      <span className="request-timestamp">
                        {new Date(req.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <div className="request-details">
                      <strong>{req.username}</strong> requested to{" "}
                      <strong>{req.action.replace("_", " ")}</strong>
                      {req.currentTime !== null &&
                        ` at ${formatTime(req.currentTime)}`}
                      {req.videoId && ` (Video: ${req.videoId})`}
                    </div>

                    {/* Host/Moderator can Approve or Reject */}
                    {canControl && (
                      <div className="request-actions-row">
                        <button
                          className="btn-approve"
                          onClick={() => handleApproveRequest(req.id)}
                        >
                          ✓ Approve
                        </button>
                        <button
                          className="btn-reject"
                          onClick={() => handleRejectRequest(req.id)}
                        >
                          ✕ Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    color: "#94a3b8",
                    padding: "36px 16px",
                    fontSize: "14px",
                  }}
                >
                  <p style={{ fontSize: "28px", margin: "0 0 10px" }}>⚡</p>
                  <p style={{ fontWeight: 600, color: "#cbd5e1" }}>
                    No pending requests
                  </p>
                  <p style={{ fontSize: "13px" }}>
                    When participants request to play, pause, seek, or change
                    videos, their requests will appear here for approval.
                  </p>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* PARTICIPANT SEEK MODAL */}
      {requestModalAction === "seek" && (
        <div className="request-modal-overlay">
          <div className="request-modal-box">
            <h3>Request Seek Position</h3>
            <p style={{ fontSize: "14px", color: "#94a3b8" }}>
              Choose a playback timestamp to request permission from the host:
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <input
                type="range"
                className="seek-slider"
                min="0"
                max={duration > 0 ? duration : 100}
                value={requestSeekTime}
                onChange={(e) => setRequestSeekTime(Number(e.target.value))}
              />
              <span className="time-counter">
                {formatTime(requestSeekTime)}
              </span>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <button
                className="btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setRequestModalAction(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{ flex: 1 }}
                onClick={handleParticipantSeekRequest}
              >
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATIONS */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span>{toast.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Room;
