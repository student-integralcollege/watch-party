import { useState, useEffect } from "react";
import Home from "./pages/Home";
import Room from "./pages/Room";

function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [activeRoom, setActiveRoom] = useState(() => {
    // Attempt to restore active session from sessionStorage
    try {
      const saved = sessionStorage.getItem("watchparty_active_room");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Listen to browser navigation (back/forward)
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Parse room code from /room/:roomId
  const roomMatch = currentPath.match(/^\/room\/([a-zA-Z0-9_-]+)/i);
  const pathRoomId = roomMatch ? roomMatch[1].toLowerCase() : null;

  // Handle entering a room
  function handleEnterRoom(roomData) {
    setActiveRoom(roomData);
    sessionStorage.setItem("watchparty_active_room", JSON.stringify(roomData));
    const newPath = `/room/${roomData.roomId}`;
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, "", newPath);
      setCurrentPath(newPath);
    }
  }

  // Handle leaving a room
  function handleLeaveRoom() {
    setActiveRoom(null);
    sessionStorage.removeItem("watchparty_active_room");
    window.history.pushState(null, "", "/");
    setCurrentPath("/");
  }

  // If we have an active room and the URL matches that room (or user just joined)
  if (activeRoom && (!pathRoomId || pathRoomId === activeRoom.roomId.toLowerCase())) {
    return (
      <Room
        roomId={activeRoom.roomId}
        participant={activeRoom.participant}
        initialRoom={activeRoom.initialRoom}
        onLeave={handleLeaveRoom}
      />
    );
  }

  // If user navigated directly to /room/:roomId without joining yet, show Home pre-filled with that code
  return (
    <Home
      initialRoomCode={pathRoomId || ""}
      onEnterRoom={handleEnterRoom}
    />
  );
}

export default App;
