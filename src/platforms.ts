//! Chat surfaces for the preview. Backgrounds: Slack's message pane, Discord's chat area per theme
//! (Discord client stylesheet, 2025 refresh). Emoji sizes are the CSS pixel sizes each client shows.

export type Surface = {
  id: string;
  app: "Slack" | "Discord";
  theme: string;
  bg: string;
  text: string;
  muted: string;
  reaction: string;
  inline: number;
  jumbo: number;
  react: number;
};

const slack = { app: "Slack", inline: 22, jumbo: 32, react: 16 } as const;
const discord = { app: "Discord", inline: 22, jumbo: 48, react: 16 } as const;

export const SURFACES: Surface[] = [
  { ...slack, id: "slack-light", theme: "Light", bg: "#ffffff", text: "#1d1c1d", muted: "#616061", reaction: "#1d1c1d10" },
  { ...slack, id: "slack-dark", theme: "Dark", bg: "#1a1d21", text: "#d1d2d3", muted: "#ababad", reaction: "#e8e8e812" },
  { ...discord, id: "discord-light", theme: "Light", bg: "#fbfbfb", text: "#2e3035", muted: "#5c5e66", reaction: "#ebebed" },
  { ...discord, id: "discord-ash", theme: "Ash", bg: "#323339", text: "#dbdee1", muted: "#949ba4", reaction: "#3e3f46" },
  { ...discord, id: "discord-dark", theme: "Dark", bg: "#1a1a1e", text: "#dbdee1", muted: "#949ba4", reaction: "#28282d" },
  { ...discord, id: "discord-onyx", theme: "Onyx", bg: "#131416", text: "#dbdee1", muted: "#949ba4", reaction: "#212226" },
];
