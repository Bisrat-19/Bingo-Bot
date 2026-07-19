// Mutable runtime facts discovered after startup (e.g. the bot's own username, needed
// to build t.me Mini App deep links). Set once during bootstrap.
export const runtime: { botUsername?: string } = {};
