/**
 * Vercel Serverless Function - /api/games
 *
 * Returns the list of games currently available or created
 */

import { GameStorageManager } from "../src/storage/game_store.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const gameStore = new GameStorageManager();
    const games = await gameStore.listGames();
    return res.status(200).json(games);
  } catch (err) {
    return res.status(200).json([]);
  }
}
