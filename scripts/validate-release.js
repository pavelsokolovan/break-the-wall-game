import { multiplayerUrl } from "../src/online-client.js";
const value = process.env.VITE_MULTIPLAYER_URL;
if (value && !multiplayerUrl({ VITE_MULTIPLAYER_URL: value })) {
  console.error(
    "Invalid VITE_MULTIPLAYER_URL: use the actual public wss://host/ws URL, with no credentials, query or fragment.",
  );
  process.exitCode = 1;
}
