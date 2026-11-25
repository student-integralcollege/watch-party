import { useEffect, useRef, useState } from "react";
import YouTube from "react-youtube";

function YouTubePlayer({
  videoId,
  command,
  canControl,
  onTimeUpdate,
  onDurationChange,
}) {
  const playerRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [playerError, setPlayerError] = useState(null);
  const commandRef = useRef(command);
  commandRef.current = command;

  const opts = {
    width: "100%",
    height: "100%",
    playerVars: {
      autoplay: 0,
      controls: 0, // Synchronized controls used below player
      disablekb: canControl ? 0 : 1,
      enablejsapi: 1,
      modestbranding: 1,
      rel: 0,
      fs: 1,
      playsinline: 1,
    },
  };

  // Helper to apply synchronized commands to YouTube player
  const applyCommand = (cmd, player) => {
    if (!player || !cmd) return;

    const targetTime = Number(cmd.currentTime) || 0;

    try {
      if (cmd.action === "play") {
        player.seekTo(targetTime, true);
        player.playVideo();
      } else if (cmd.action === "pause") {
        player.seekTo(targetTime, true);
        player.pauseVideo();
      } else if (cmd.action === "seek") {
        player.seekTo(targetTime, true);
      } else if (cmd.action === "sync") {
        player.seekTo(targetTime, true);
        if (cmd.playbackState === "playing") {
          player.playVideo();
        } else {
          player.pauseVideo();
        }
      } else if (cmd.action === "change_video") {
        player.seekTo(0, true);
        player.pauseVideo();
      }
    } catch (err) {
      console.warn("YouTube player command error:", err);
    }
  };

  // Player Ready Handler
  function onReady(event) {
    const player = event.target;
    playerRef.current = player;
    setIsReady(true);
    setPlayerError(null);

    try {
      const dur = player.getDuration();
      if (dur && onDurationChange) {
        onDurationChange(dur);
      }
    } catch (e) {
      console.warn("Failed to get video duration:", e);
    }

    // Apply any pending or current command
    if (commandRef.current) {
      applyCommand(commandRef.current, player);
    }
  }

  // Handle YouTube Player Errors (101/150 = embedded restricted, 100 = private/deleted, 2 = invalid param)
  function onError(event) {
    const errorCode = event.data;
    console.error("YouTube Player Error:", errorCode);

    let errorMsg = "An error occurred while loading this YouTube video.";
    if (errorCode === 101 || errorCode === 150) {
      errorMsg = "Embedding restricted: The creator or copyright holder of this video has disabled playback in third-party embedded players. Please try another video.";
    } else if (errorCode === 100) {
      errorMsg = "Video not found: This video is either private or has been removed from YouTube.";
    } else if (errorCode === 2) {
      errorMsg = "Invalid video ID parameter.";
    }

    setPlayerError(errorMsg);
  }

  // Execute synchronized commands received from server
  useEffect(() => {
    if (!isReady || !playerRef.current || !command) return;
    applyCommand(command, playerRef.current);
  }, [command, isReady]);

  // Periodic position update and drift correction
  useEffect(() => {
    if (!isReady || !playerRef.current) return;

    const interval = setInterval(() => {
      try {
        const player = playerRef.current;
        if (!player || typeof player.getCurrentTime !== "function") return;

        const current = player.getCurrentTime() || 0;
        if (onTimeUpdate) {
          onTimeUpdate(current);
        }

        const dur = player.getDuration();
        if (dur && onDurationChange) {
          onDurationChange(dur);
        }

        // Drift correction: if server says playing, verify client is in lockstep
        if (command && command.playbackState === "playing") {
          const elapsed = (Date.now() - (command.serverTimestamp || Date.now())) / 1000;
          const expectedTime = Math.max(0, (command.currentTime || 0) + elapsed);

          // Correct drift if greater than 3.0 seconds
          if (Math.abs(current - expectedTime) > 3.0) {
            console.log(`[Drift Correction] Seeking from ${current.toFixed(1)}s to ${expectedTime.toFixed(1)}s`);
            player.seekTo(expectedTime, true);
          }
        }
      } catch (err) {
        // Player buffering or unmounting
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isReady, command, onTimeUpdate, onDurationChange]);

  // Reset error when videoId changes
  useEffect(() => {
    setPlayerError(null);
    setIsReady(false);
  }, [videoId]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        background: "#08080e",
        borderRadius: "14px",
        overflow: "hidden",
        border: "1px solid #272738",
      }}
    >
      {videoId ? (
        <>
          {playerError ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#fca5a5",
                gap: "12px",
                padding: "24px",
                textAlign: "center",
                background: "rgba(239, 68, 68, 0.08)",
              }}
            >
              <span style={{ fontSize: "32px" }}>⚠️</span>
              <h4 style={{ margin: 0, fontSize: "16px", color: "#f87171" }}>
                Cannot play this video
              </h4>
              <p style={{ margin: 0, fontSize: "13px", maxWidth: "460px", color: "#cbd5e1" }}>
                {playerError}
              </p>
            </div>
          ) : (
            <YouTube
              key={videoId}
              videoId={videoId}
              opts={opts}
              onReady={onReady}
              onError={onError}
              className="youtube-player-frame"
              style={{ width: "100%", height: "100%" }}
            />
          )}

          {/* Click capture layer for viewers: prevents desyncing via native iframe click */}
          {!canControl && !playerError && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                zIndex: 2,
                cursor: "default",
                background: "transparent",
              }}
              title="Only host/moderator can control playback directly. Use request buttons below."
            />
          )}
        </>
      ) : (
        <div
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#94a3b8",
            gap: "12px",
            padding: "20px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: "#1e1e2d",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#a78bfa",
              fontSize: "24px",
            }}
          >
            ▶
          </div>
          <h3 style={{ margin: 0, color: "#f1f5f9", fontSize: "18px" }}>
            No video loaded yet
          </h3>
          <p style={{ margin: 0, fontSize: "14px", maxWidth: "380px" }}>
            {canControl
              ? "Paste a YouTube link above to start watching with the room!"
              : "Waiting for the host to select a YouTube video..."}
          </p>
        </div>
      )}
    </div>
  );
}

export default YouTubePlayer;
