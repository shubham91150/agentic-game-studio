import GamePlayer from "../../components/game-player.js";

export const metadata = {
  title: "Demo Player — Agentic Game Studio",
  description: "A touch-ready local demo scene from Agentic Game Studio.",
};

export default async function PlayPage({ searchParams }) {
  const params = await searchParams;
  const idea = typeof params?.idea === "string" ? params.idea : "";

  return <GamePlayer idea={idea} />;
}
