import type { ShareResultPayload } from "./result-types";

export type SharePresentation = {
  kicker: string;
  headline: string;
  challenge: string;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel: string;
  secondaryValue: string;
  tertiaryLabel: string;
  tertiaryValue: string;
};

export function sharePresentation(result: ShareResultPayload): SharePresentation {
  if (result.mode === "ayah-counts" && result.variant === "closest") {
    return {
      kicker: "AYAH COUNTS · CLOSEST FIGURE",
      headline: "How close can you get?",
      challenge: "How close can you get?",
      primaryLabel: "POINTS",
      primaryValue: String(result.score),
      secondaryLabel: "EXACT",
      secondaryValue: String(result.exact),
      tertiaryLabel: "AVG PROXIMITY",
      tertiaryValue: String(result.averageProximity ?? 0),
    };
  }

  if (result.mode === "ayah-counts") {
    return {
      kicker: "AYAH COUNTS · EXACT FIGURE",
      headline: "Know the count?",
      challenge: "Know your Ayah counts?",
      primaryLabel: "EXACT",
      primaryValue: `${result.roundsWon}/${result.roundsPlayed}`,
      secondaryLabel: "POINTS",
      secondaryValue: String(result.score),
      tertiaryLabel: "BEST STREAK",
      tertiaryValue: String(result.bestStreak),
    };
  }

  if (result.mode === "completion" && result.variant === "sequence") {
    return {
      kicker: "COMPLETION · SEQUENCE",
      headline: "Do you know what comes next?",
      challenge: "Do you know what comes next?",
      primaryLabel: "CORRECT",
      primaryValue: `${result.roundsWon}/${result.roundsPlayed}`,
      secondaryLabel: "POINTS",
      secondaryValue: String(result.score),
      tertiaryLabel: "BEST STREAK",
      tertiaryValue: String(result.bestStreak),
    };
  }

  if (result.mode === "completion") {
    return {
      kicker: "COMPLETION · FILL-IN",
      headline: "Can you complete the verse?",
      challenge: "Can you complete the verse?",
      primaryLabel: "COMPLETED",
      primaryValue: `${result.roundsWon}/${result.roundsPlayed}`,
      secondaryLabel: "POINTS",
      secondaryValue: String(result.score),
      tertiaryLabel: "FIRST TRY",
      tertiaryValue: String(result.firstTryWins),
    };
  }

  return {
    kicker: "SURAH RECOGNITION",
    headline: "Can you recognize the Surah?",
    challenge: "Can you recognize them all?",
    primaryLabel: "RECOGNIZED",
    primaryValue: `${result.roundsWon}/${result.roundsPlayed}`,
    secondaryLabel: "POINTS",
    secondaryValue: String(result.score),
    tertiaryLabel: "BEST STREAK",
    tertiaryValue: String(result.bestStreak),
  };
}

export function roundStateEmoji(state: ShareResultPayload["roundStates"][number]) {
  switch (state) {
    case "perfect": return "🟩";
    case "close": return "🟨";
    case "skipped": return "⬜";
    default: return "⬛";
  }
}

export function formatShareResultText(result: ShareResultPayload, shareUrl: string) {
  const presentation = sharePresentation(result);
  const board = result.roundStates.map(roundStateEmoji).join(" ");

  const lines = [
    `SurahSpot · ${presentation.kicker.replace(" · ", "\n")}`,
    "",
  ];

  if (result.mode === "ayah-counts" && result.variant === "closest") {
    lines.push(
      `${result.score} pts`,
      `${result.exact} exact · Avg proximity ${result.averageProximity ?? 0}`,
    );
  } else if (result.mode === "ayah-counts") {
    lines.push(`${result.roundsWon}/${result.roundsPlayed} exact · ${result.score} pts`);
  } else if (result.mode === "completion") {
    lines.push(`${result.roundsWon}/${result.roundsPlayed} completed · ${result.score} pts`);
  } else {
    lines.push(
      `${result.roundsWon}/${result.roundsPlayed} recognized`,
      `${result.score} pts · 🔥 ${result.bestStreak} streak`,
    );
  }

  if (board) lines.push("", board);
  lines.push("", presentation.challenge, shareUrl);
  return lines.join("\n");
}
