import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error(
    "Missing MONGODB_URI in environment variables. Add it to your .env file.\n" +
    "Example: MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/watchparty?retryWrites=true&w=majority"
  );
}

let isConnected = false;

mongoose.connection.on("disconnected", () => {
  isConnected = false;
  console.warn("[MongoDB] Connection lost; the driver will attempt to reconnect.");
});

mongoose.connection.on("reconnected", () => {
  isConnected = true;
  console.log("[MongoDB] Connection restored.");
});

mongoose.connection.on("error", (err) => {
  console.error("[MongoDB] Connection error:", err.message);
});

export async function connectDB() {
  if (isConnected) return;

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    isConnected = true;
    console.log("[MongoDB] Connected to Atlas successfully.");
  } catch (err) {
    console.error("[MongoDB] Initial connection failed:", err.message);
    throw err;
  }
}

export default mongoose;
