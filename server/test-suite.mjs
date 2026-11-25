import { spawn } from "child_process";
import { io } from "../client/node_modules/socket.io-client/build/esm/index.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 5055;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

console.log("=== STARTING WATCHPARTY END-TO-END VERIFICATION ===");

// 1. Launch server on test port
const serverProcess = spawn("node", ["server.js"], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(TEST_PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});

serverProcess.stdout.on("data", (d) => {
  const line = d.toString().trim();
  if (line) console.log(`[Server] ${line}`);
});

serverProcess.stderr.on("data", (d) => {
  const line = d.toString().trim();
  if (line) console.error(`[Server Error] ${line}`);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  await sleep(1500); // Wait for server to start

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✓ PASS: ${message}`);
      testsPassed++;
    } else {
      console.error(`✗ FAIL: ${message}`);
      testsFailed++;
    }
  }

  let aliceSocket, bobSocket, charlieSocket;

  try {
    // TEST 1: Health check
    const healthRes = await fetch(`${BASE_URL}/`);
    const healthData = await healthRes.json();
    assert(healthData.status === "ok", "Server health check returns ok");

    // TEST 2: Create room (Alice as Host)
    const createRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Alice" }),
    });
    const createData = await createRes.json();
    assert(createData.success === true, "Room creation succeeds");
    assert(createData.room.roomId.length === 8, "Room ID is 8 characters long");
    assert(createData.participant.role === "host", "Room creator is assigned host role");

    const roomId = createData.room.roomId;
    const alice = createData.participant;

    // TEST 3: Join room (Bob as Participant)
    const joinBobRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Bob" }),
    });
    const joinBobData = await joinBobRes.json();
    assert(joinBobData.success === true, "Bob successfully joins room");
    assert(joinBobData.participant.role === "participant", "Bob joins as participant");
    const bob = joinBobData.participant;

    // TEST 4: Join room (Charlie as Participant)
    const joinCharlieRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Charlie" }),
    });
    const joinCharlieData = await joinCharlieRes.json();
    assert(joinCharlieData.success === true, "Charlie successfully joins room");
    const charlie = joinCharlieData.participant;

    // TEST 5: Sockets Connect and Join Room
    aliceSocket = io(BASE_URL);
    bobSocket = io(BASE_URL);
    charlieSocket = io(BASE_URL);

    await new Promise((resolve) => {
      let count = 0;
      function check() {
        count++;
        if (count === 3) resolve();
      }
      aliceSocket.on("connect", () => {
        aliceSocket.emit("join_room", { roomId, participantId: alice.id });
        check();
      });
      bobSocket.on("connect", () => {
        bobSocket.emit("join_room", { roomId, participantId: bob.id });
        check();
      });
      charlieSocket.on("connect", () => {
        charlieSocket.emit("join_room", { roomId, participantId: charlie.id });
        check();
      });
    });

    await sleep(500);
    assert(true, "All 3 users connected and joined via Socket.IO");

    // TEST 6: Video Change Synchronization (Alice changes video)
    const bobVideoPromise = new Promise((resolve) => {
      bobSocket.on("playback_sync", (sync) => {
        if (sync.action === "change_video" && sync.videoId === "dQw4w9WgXcQ") {
          resolve(sync);
        }
      });
    });

    aliceSocket.emit("change_video", { videoId: "dQw4w9WgXcQ" });
    const syncResult = await bobVideoPromise;
    assert(syncResult.videoId === "dQw4w9WgXcQ", "Bob received synchronized video change");

    // TEST 7: Synchronized Play
    const bobPlayPromise = new Promise((resolve) => {
      bobSocket.on("playback_sync", (sync) => {
        if (sync.action === "play" && sync.playbackState === "playing") {
          resolve(sync);
        }
      });
    });

    aliceSocket.emit("play", { currentTime: 10 });
    const playResult = await bobPlayPromise;
    assert(playResult.playbackState === "playing", "Bob received synchronized play event");

    // TEST 8: RBAC Permission Enforcement (Participant cannot directly play/pause)
    const bobErrorPromise = new Promise((resolve) => {
      bobSocket.on("room_error", (errMsg) => {
        resolve(errMsg);
      });
    });

    bobSocket.emit("pause", { currentTime: 15 });
    const bobError = await bobErrorPromise;
    assert(
      bobError.includes("Only the host or moderators can directly pause"),
      "Backend rejected unauthorized playback pause from participant"
    );

    // TEST 9: Participant Approval Request Lifecycle
    // Bob sends a seek request
    const aliceRequestPromise = new Promise((resolve) => {
      aliceSocket.on("new_approval_request", (req) => {
        resolve(req);
      });
    });

    bobSocket.emit("request_action", { action: "seek", currentTime: 45 });
    const receivedRequest = await aliceRequestPromise;
    assert(
      receivedRequest.username === "Bob" && receivedRequest.action === "seek",
      "Host received Bob's seek approval request"
    );

    // Host approves request
    const bobApprovalPromise = new Promise((resolve) => {
      bobSocket.on("request_handled", (res) => {
        if (res.requestId === receivedRequest.id) {
          resolve(res);
        }
      });
    });

    aliceSocket.emit("approve_request", { requestId: receivedRequest.id });
    const approvalRes = await bobApprovalPromise;
    assert(approvalRes.status === "approved", "Bob received approval confirmation for seek request");

    // TEST 10: Role Promotion (Host promotes Bob to Moderator)
    const bobPromotionPromise = new Promise((resolve) => {
      bobSocket.on("room_updated", (roomState) => {
        const bobInRoom = roomState.participants.find((p) => p.id === bob.id);
        if (bobInRoom && bobInRoom.role === "moderator") {
          resolve(bobInRoom);
        }
      });
    });

    aliceSocket.emit("promote_moderator", { targetParticipantId: bob.id });
    const promotedBob = await bobPromotionPromise;
    assert(promotedBob.role === "moderator", "Bob successfully promoted to Moderator by Host");

    // Bob as Moderator can now directly pause
    const alicePausePromise = new Promise((resolve) => {
      aliceSocket.on("playback_sync", (sync) => {
        if (sync.action === "pause") {
          resolve(sync);
        }
      });
    });

    bobSocket.emit("pause", { currentTime: 45 });
    const pauseResult = await alicePausePromise;
    assert(pauseResult.playbackState === "paused", "Bob (as Moderator) can directly pause playback");

    // TEST 11: Real-time Chat
    const chatPromise = new Promise((resolve) => {
      aliceSocket.on("new_message", (msg) => {
        if (msg.senderId === bob.id && msg.text === "Hello WatchParty!") {
          resolve(msg);
        }
      });
    });

    bobSocket.emit("send_message", { text: "Hello WatchParty!" });
    const chatMsg = await chatPromise;
    assert(chatMsg.text === "Hello WatchParty!", "Alice received Bob's chat message in real time");

    // TEST 12: Kick Participant (Alice kicks Charlie)
    const charlieKickedPromise = new Promise((resolve) => {
      charlieSocket.on("kicked", (reason) => {
        resolve(reason);
      });
    });

    aliceSocket.emit("kick_participant", { targetParticipantId: charlie.id });
    const kickReason = await charlieKickedPromise;
    assert(kickReason.includes("removed from this room"), "Charlie received kicked event from host");

    // Verify Charlie cannot rejoin
    const rejoinRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Charlie", participantId: charlie.id }),
    });
    assert(rejoinRes.status === 403, "Kicked participant is blocked from rejoining (HTTP 403)");

    // TEST 13: Host Transfer (Alice transfers host to Bob)
    const hostTransferPromise = new Promise((resolve) => {
      bobSocket.on("room_updated", (roomState) => {
        if (roomState.hostId === bob.id) {
          resolve(roomState);
        }
      });
    });

    aliceSocket.emit("transfer_host", { targetParticipantId: bob.id });
    const transferredRoom = await hostTransferPromise;
    assert(transferredRoom.hostId === bob.id, "Bob successfully became the new Host");

    console.log(`\n========================================`);
    console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
    console.log(`========================================\n`);

    if (testsFailed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Test execution failed with exception:", err);
    process.exit(1);
  } finally {
    if (aliceSocket) aliceSocket.disconnect();
    if (bobSocket) bobSocket.disconnect();
    if (charlieSocket) charlieSocket.disconnect();
    serverProcess.kill();
  }
}

runTests();
