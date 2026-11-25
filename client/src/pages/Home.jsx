import { useState, useEffect } from "react";
import { BACKEND_URL } from "../utils/config";

function Home({ initialRoomCode = "", onEnterRoom }) {
  const [username, setUsername] = useState(() => {
    return localStorage.getItem("watchparty_username") || "";
  });
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (initialRoomCode) {
      setRoomCode(initialRoomCode);
    }
  }, [initialRoomCode]);

  // Persist username in local storage
  function handleUsernameChange(val) {
    setUsername(val);
    localStorage.setItem("watchparty_username", val);
  }

  // CREATE ROOM
  async function handleCreateRoom() {
    setErrorMessage("");
    const trimmedUser = username.trim();

    if (!trimmedUser) {
      setErrorMessage("Please enter your username first!");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(`${BACKEND_URL}/api/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: trimmedUser,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Could not create room");
      }

      onEnterRoom({
        roomId: data.room.roomId,
        participant: data.participant,
        initialRoom: data.room,
      });
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  // JOIN ROOM
  async function handleJoinRoom() {
    setErrorMessage("");
    const trimmedUser = username.trim();
    const trimmedCode = roomCode.trim();

    if (!trimmedUser) {
      setErrorMessage("Please enter your username first!");
      return;
    }

    if (!trimmedCode) {
      setErrorMessage("Please enter a room code!");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        `${BACKEND_URL}/api/rooms/${trimmedCode}/join`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: trimmedUser,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Could not join room");
      }

      onEnterRoom({
        roomId: data.room.roomId,
        participant: data.participant,
        initialRoom: data.room,
      });
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="home">
      <nav className="navbar">
        <h2>WatchParty</h2>
        <p>Watch together, anywhere.</p>
      </nav>

      {errorMessage && (
        <div
          style={{
            maxWidth: "650px",
            margin: "24px auto 0",
            padding: "14px 18px",
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid #ef4444",
            borderRadius: "10px",
            color: "#fca5a5",
            textAlign: "center",
            fontSize: "14px",
          }}
        >
          {errorMessage}
        </div>
      )}

      {initialRoomCode && (
        <div
          style={{
            maxWidth: "650px",
            margin: "20px auto 0",
            padding: "12px 18px",
            background: "rgba(124, 58, 237, 0.15)",
            border: "1px solid #7c3aed",
            borderRadius: "10px",
            color: "#c4b5fd",
            textAlign: "center",
            fontSize: "14px",
          }}
        >
          You are invited to join room: <strong>{initialRoomCode}</strong>. Enter your username to hop in!
        </div>
      )}

      <section className="hero">
        <h1>Movies are better together.</h1>

        <p>
          Create a room, invite your friends, and watch
          YouTube videos together in real time.
        </p>

        <input
          type="text"
          placeholder="Enter your username"
          value={username}
          onChange={(e) => handleUsernameChange(e.target.value)}
          className="username-input"
          autoFocus={!initialRoomCode}
        />
      </section>

      <section className="room-actions">
        <div className="room-card">
          <h2>Create a Room</h2>

          <p>
            Start a watch party and invite your friends
            to watch together.
          </p>

          <button onClick={handleCreateRoom} disabled={loading}>
            {loading ? "Please wait..." : "Create Room"}
          </button>
        </div>

        <div className="room-card">
          <h2>Join a Room</h2>

          <p>
            Have a room code? Enter it below and join your friends.
          </p>

          <input
            type="text"
            placeholder="Enter room code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
          />

          <button onClick={handleJoinRoom} disabled={loading}>
            {loading ? "Please wait..." : "Join Room"}
          </button>
        </div>
      </section>
    </main>
  );
}

export default Home;
